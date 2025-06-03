// Assuming the plugin is globally available as ChartAnnotation (common for CDN/script tag)
// If you're using ES modules, you'd import it: import Annotation from 'chartjs-plugin-annotation';
// and then Chart.register(Annotation);

if (typeof ChartAnnotation !== 'undefined') {
    Chart.register(ChartAnnotation);
    console.log('ChartAnnotation plugin explicitly registered.');
} else {
    console.warn('ChartAnnotation object not found for explicit registration. Auto-registration will be relied upon.');
}

const DATA_URL = '/api/uvdata';

let uvMap;
let netherlandsLayerA; // For cross-fading
let netherlandsLayerB; // For cross-fading
let activeLayerIsA = true; // Tracks which layer is currently visible
let fadeAnimationId = null; // To manage the fade animation frames/timeout
const GEOJSON_URL = './netherlands.geojson';
let animationIntervalId = null; // For controlling the time slider animation
let uviMapControl = null; // To display UVI on the map

const BILTHOVEN_COORDS = [52.1302, 5.1820]; // Approximate lat/lng for Bilthoven
let bilthovenUviMarker = null; // For displaying UVI at Bilthoven's location

const FADE_DURATION = 750; // milliseconds for the cross-fade
const TARGET_OPACITY = 0.5; // Target opacity for the visible layer

let manualTimeIndicatorValue = null;
let isDraggingLine = false;
const timeIndicatorLineColor = 'red';
const timeIndicatorLabelColor = 'white';
const timeIndicatorLabelBackgroundColor = 'rgba(255,0,0,0.7)';
const timeIndicatorHitboxWidth = 10; // pixels on each side for hitbox

// Custom plugin to draw the time indicator line
const manualTimeIndicatorPlugin = {
    id: 'manualTimeIndicator',
    afterDraw: (chart, args, options) => {
        if (!manualTimeIndicatorValue) return;

        const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
        const xPos = x.getPixelForValue(manualTimeIndicatorValue);

        if (xPos < left || xPos > right) return; // Don't draw if outside chart area

        ctx.save();
        // Draw Line
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = timeIndicatorLineColor;
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();

        // Draw Label
        const labelText = 'Time';
        ctx.font = '10px Arial';
        const textMetrics = ctx.measureText(labelText);
        const labelWidth = textMetrics.width + 8; // Increased padding slightly
        const labelHeight = 16; // Increased padding slightly
        
        // Position label at the top of the line, inside the chart area
        let labelX = xPos;
        let labelY = top + (labelHeight / 2) + 2; // Position near the top, +2 for slight margin from chart top line

        // Prevent label clipping (horizontal)
        if (xPos - (labelWidth/2) < left) { // If left edge of label is clipped
            labelX = left + (labelWidth/2);
        } else if (xPos + (labelWidth/2) > right) { // If right edge of label is clipped
            labelX = right - (labelWidth/2);
        }
        // Ensure label Y is within canvas top boundary (though top should handle chartArea)
        if (labelY - (labelHeight/2) < 0) labelY = (labelHeight/2);

        ctx.fillStyle = timeIndicatorLabelBackgroundColor;
        // Draw background centered around labelX now
        ctx.fillRect(labelX - (labelWidth/2), labelY - (labelHeight/2), labelWidth, labelHeight);

        ctx.fillStyle = timeIndicatorLabelColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, labelX, labelY);
        
        ctx.restore();
    }
};

// Define debounce globally or at a higher scope
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

async function fetchData() {
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const textData = await response.text();
        return parseData(textData);
    } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("Failed to load UV data. Please check the console for more details. You might be encountering a CORS issue. Try using a CORS proxy or running this on a simple web server.");
        return [];
    }
}

function parseData(textData) {
    const lines = textData.split('\n');
    const data = [];
    const headerString = "YYYYMMDD hhmm  T.dec   UVI InstCode"; // Define the exact header string

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('#') || trimmedLine === '' || trimmedLine === headerString) {
            continue;
        }
        const parts = trimmedLine.split(/\s+/); // Split by one or more spaces
        if (parts.length >= 4) { // Ensure we have at least date, time, t.dec, and UVI
            const [YYYYMMDD, hhmm, tDec, uviStr, instCode] = parts;
            const year = parseInt(YYYYMMDD.substring(0, 4), 10);
            const month = parseInt(YYYYMMDD.substring(4, 6), 10) - 1; // JS months are 0-indexed
            const day = parseInt(YYYYMMDD.substring(6, 8), 10);
            const hour = parseInt(hhmm.substring(0, 2), 10);
            const minute = parseInt(hhmm.substring(2, 4), 10);

            const date = new Date(Date.UTC(year, month, day, hour, minute));
            const uvi = parseFloat(uviStr);

            if (!isNaN(date.getTime()) && !isNaN(uvi)) {
                data.push({
                    date: date,
                    uvi: uvi,
                    tDec: parseFloat(tDec),
                    instCode: instCode || 'N/A'
                });
            } else {
                console.warn('Skipping malformed line:', line);
            }
        } else {
            console.warn('Skipping line with insufficient parts:', line);
        }
    }
    console.log("Parsed data:", data);
    // sort data by date ascending just in case it's not already
    data.sort((a,b) => a.date - b.date);
    return data;
}

let currentLocalHour = 12; // Make currentLocalHour more broadly accessible
// Store for the currently selected day's generated hourly data
let currentHourlyDataForDay = []; 

// Default parameters for the parabolic model
const UV_MODEL_PARAMS = {
    halfDayDurationHours: 6 // UV is active for this many hours before and after the peak
};

function generateHourlyDataForDay(peakDataEntry, modelParams) {
    if (!peakDataEntry) {
        return [];
    }

    const hourlyData = [];
    const peakUvi = peakDataEntry.uvi;
    const peakDate = new Date(peakDataEntry.date); // Ensure it's a Date object

    // The peak time is already in UTC (e.g., YYYY-MM-DD 12:00:00 UTC from parsed data)
    const peakHourUtc = peakDate.getUTCHours();

    const startHourUtc = peakHourUtc - modelParams.halfDayDurationHours;
    const endHourUtc = peakHourUtc + modelParams.halfDayDurationHours;

    for (let h = 0; h < 24; h++) { // Iterate through all hours of the day UTC
        let uviValue = 0;
        if (h >= startHourUtc && h <= endHourUtc) {
            // Parabolic model: UVI(h) = PeakUVI * (1 - ((h - peakHour) / halfDayDurationHours)^2)
            const hourOffset = h - peakHourUtc;
            uviValue = peakUvi * (1 - Math.pow(hourOffset / modelParams.halfDayDurationHours, 2));
            uviValue = Math.max(0, uviValue); // Ensure UVI is not negative
        }

        const currentHourDate = new Date(peakDate);
        currentHourDate.setUTCHours(h, 0, 0, 0); // Set to the current hour in UTC

        hourlyData.push({
            date: currentHourDate,
            uvi: uviValue,
            // tDec and instCode might not be relevant for modeled data, or could be set to defaults
            tDec: peakDataEntry.tDec, 
            instCode: peakDataEntry.instCode ? peakDataEntry.instCode + "_MODEL" : "MODEL"
        });
    }
    // console.log(`Generated hourly data for ${peakDate.toUTCString()}:`, hourlyData);
    return hourlyData;
}

async function initializeApp() {
    await initializeMap();
    // fetchData now returns daily peak data
    window.allDailyPeakUvData = await fetchData(); 
    console.log("Fetched allDailyPeakUvData in initializeApp:", window.allDailyPeakUvData ? window.allDailyPeakUvData.length : 0, "entries");

    const datePicker = document.getElementById('datePicker');
    const selectedTimeLabel = document.getElementById('selectedTimeLabel');
    let initialDateToDisplay = null;
    let isTodaySelected = false;

    const todayAmsterdam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    const todayYear = todayAmsterdam.getFullYear();
    const todayMonth = todayAmsterdam.getMonth(); // 0-indexed
    const todayDay = todayAmsterdam.getDate();
    currentLocalHour = todayAmsterdam.getHours(); 

    if (window.allDailyPeakUvData && window.allDailyPeakUvData.length > 0) {
        const dataForTodayExists = window.allDailyPeakUvData.some(d => {
            const recordDate = new Date(d.date); 
            // Compare based on UTC dates since daily peak data is at a fixed UTC time (noon)
            return recordDate.getUTCFullYear() === todayYear &&
                   recordDate.getUTCMonth() === todayMonth &&
                   recordDate.getUTCDate() === todayDay;
        });

        if (dataForTodayExists) {
            initialDateToDisplay = new Date(Date.UTC(todayYear, todayMonth, todayDay, 12, 0, 0)); // Use noon UTC for consistency
            isTodaySelected = true;
            console.log("Data for today exists. Setting date picker to today.");
        } else {
            // Fallback: use the latest date in the dataset if today's data isn't present
            // Ensure we use the date part of the last entry, setting time to noon UTC
            const lastEntryDate = new Date(window.allDailyPeakUvData[window.allDailyPeakUvData.length - 1].date);
            initialDateToDisplay = new Date(Date.UTC(lastEntryDate.getUTCFullYear(), lastEntryDate.getUTCMonth(), lastEntryDate.getUTCDate(), 12, 0, 0));
            currentLocalHour = 12; 
            console.log("Data for today NOT found. Setting date picker to latest available date:", initialDateToDisplay.toUTCString());
        }

        if (datePicker) {
            // Set date picker to the date part of initialDateToDisplay (which is UTC noon)
            datePicker.value = `${initialDateToDisplay.getUTCFullYear()}-${String(initialDateToDisplay.getUTCMonth() + 1).padStart(2, '0')}-${String(initialDateToDisplay.getUTCDate()).padStart(2, '0')}`;
            datePicker.addEventListener('change', () => {
                const selectedParts = datePicker.value.split('-').map(Number);
                isTodaySelected = (selectedParts[0] === todayYear && (selectedParts[1] - 1) === todayMonth && selectedParts[2] === todayDay);
                if (isTodaySelected) {
                    currentLocalHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getHours();
                } else {
                    currentLocalHour = 12; 
                }
                renderForSelectedDate(); // This will now generate hourly data
            });
        }
        
        if (selectedTimeLabel) selectedTimeLabel.textContent = `${String(currentLocalHour).padStart(2, '0')}:00 (Local)`;

        renderForSelectedDate(); // Initial render, will generate hourly data
        startAutoTimeSliderAnimation(currentLocalHour, isTodaySelected);

    } else {
        // Handle case with no data at all
        if (selectedTimeLabel) selectedTimeLabel.textContent = `12:00 (Local)`; // Default display
        setOverlayColorImmediately(currentLocalHour); 
        document.getElementById('currentUVI').textContent = "Latest UVI: N/A";
        document.getElementById('currentRecommendation').textContent = "No data available.";
        document.getElementById('dailyPeakUVI').textContent = "Daily Peak: N/A";
        const chartCtx = document.getElementById('uvChart').getContext('2d');
        if (window.uvIndexChart) { window.uvIndexChart.destroy(); }
        if (chartCtx) {
            chartCtx.clearRect(0, 0, chartCtx.canvas.width, chartCtx.canvas.height);
            chartCtx.fillText("No UV data loaded.", 10, 50);
        }
    }
}

async function initializeMap() {
    uvMap = L.map('map').setView([52.3, 5.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(uvMap);

    // Initialize UVI marker for Bilthoven
    bilthovenUviMarker = L.marker(BILTHOVEN_COORDS, {
        icon: L.divIcon({
            className: 'bilthoven-uvi-label',
            html: 'UVI: --',
            iconSize: [80, 25], // Approximate size, adjust with CSS
            iconAnchor: [40, 12] // Center of the icon
        })
    }).addTo(uvMap);

    const baseStyle = {
        color: "#333", // Border color for both layers
        weight: 1,
        opacity: 0.6, // Border opacity
    };

    try {
        const response = await fetch(GEOJSON_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch GeoJSON: ${response.status} ${response.statusText}`);
        }
        const geojsonData = await response.json(); // Assuming geojsonData is an object

        // Deep copy GeoJSON data for each layer to prevent shared references if styling individual features later
        const geojsonDataCopyA = JSON.parse(JSON.stringify(geojsonData));
        const geojsonDataCopyB = JSON.parse(JSON.stringify(geojsonData));

        // Create Layer A - initially visible
        netherlandsLayerA = L.geoJSON(geojsonDataCopyA, { 
            style: { ...baseStyle, fillColor: "#cccccc", fillOpacity: 0.5 } 
        }).addTo(uvMap);
        activeLayerIsA = true;

        // Create Layer B - initially hidden
        netherlandsLayerB = L.geoJSON(geojsonDataCopyB, { 
            style: { ...baseStyle, fillColor: "#cccccc", fillOpacity: 0 } 
        }).addTo(uvMap);

        console.log("Netherlands GeoJSON layers A and B added to map.");

        if (netherlandsLayerA.getBounds().isValid()) {
            uvMap.fitBounds(netherlandsLayerA.getBounds(), { padding: [30, 30] });
        } else {
            console.warn("GeoJSON layer bounds are not valid, cannot auto-fit map.");
        }
    } catch (error) {
        console.error("Error loading or adding GeoJSON layers:", error);
        alert(`Could not load the map layer for the Netherlands. Error: ${error.message}`);
    }
}

function updateUvOverlay(localHour) {
    if (!netherlandsLayerA || !netherlandsLayerB) {
        console.log("GeoJSON layers not available for overlay update.");
        return;
    }
    // Determine UVI for the given localHour using the correct data source
    const uviForHour = getUviForHour(localHour);
    
    // Use the existing cross-fade function to update the overlay
    crossFadeToUviColor(uviForHour);
}

function getUviColor(uvi) {
    if (uvi === null || uvi === undefined) return '#a0c4ff'; // Light blue for no data / not applicable
    if (uvi >= 7) return 'red';
    if (uvi >= 5) return 'orange';
    if (uvi >= 3) return 'yellow';
    if (uvi > 0 && uvi <= 2) return 'green'; // UVI 1-2 is green
    if (uvi === 0) return '#bde0fe'; // Slightly different light blue for UVI 0
    return '#a0c4ff'; // Default fallback, same as no data
}

function renderForSelectedDate() {
    const datePicker = document.getElementById('datePicker');
    if (!datePicker || !datePicker.value) {
        console.warn("renderForSelectedDate called without a valid date picker value.");
        currentHourlyDataForDay = []; // Clear data if no valid date
        renderChart([], new Date()); // Render empty chart
        updateDailyPeak([]);
        updateCurrentStatus([]);
        return;
    }
    const selectedDateStr = datePicker.value; // YYYY-MM-DD
    const parts = selectedDateStr.split('-').map(Number);
    // We construct a UTC date object representing noon on the selected day,
    // as our peak data is keyed by noon UTC.
    const selectedDateUtcNoon = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));

    console.log("Rendering for selected UTC date (noon):", selectedDateUtcNoon.toUTCString());

    // Find the peak data entry for the selected day
    const peakEntryForDay = window.allDailyPeakUvData.find(d => {
        const recordDate = new Date(d.date);
        return recordDate.getUTCFullYear() === selectedDateUtcNoon.getUTCFullYear() &&
               recordDate.getUTCMonth() === selectedDateUtcNoon.getUTCMonth() &&
               recordDate.getUTCDate() === selectedDateUtcNoon.getUTCDate();
    });

    if (peakEntryForDay) {
        console.log("Found peak entry for the day:", peakEntryForDay);
        currentHourlyDataForDay = generateHourlyDataForDay(peakEntryForDay, UV_MODEL_PARAMS);
    } else {
        console.warn("No peak UV data found for selected date:", selectedDateUtcNoon.toUTCString());
        currentHourlyDataForDay = generateHourlyDataForDay(null, UV_MODEL_PARAMS); // Will return empty array
    }
    
    console.log("Generated hourly data for chart:", currentHourlyDataForDay.length, "entries");
    renderChart(currentHourlyDataForDay, selectedDateUtcNoon); // Pass UTC noon date as reference
    updateDailyPeak(currentHourlyDataForDay); // Update daily peak based on the full day's (generated) data
    // updateCurrentStatus might need adjustment if it expects raw data vs generated
    // For now, it receives all daily peaks, but could be focused on current day's hourly data
    updateCurrentStatus(window.allDailyPeakUvData, selectedDateUtcNoon); 
    updateUvOverlay(currentLocalHour); // Update map overlay based on current local hour
}

function renderChart(dataForDay, selectedDate) {
    console.log(`RenderChart called for ${selectedDate.toDateString()} with data:`, dataForDay.length, "entries");
    
    const canvas = document.getElementById('uvChart')
    const ctx = canvas.getContext('2d');

    if (window.uvIndexChart) {
        window.uvIndexChart.destroy();
    }

    if (dataForDay.length === 0) {
        console.log(`No data available for ${selectedDate.toDateString()} to render chart.`);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // Clear previous chart
        ctx.font = "16px Arial";
        ctx.fillText(`No UV data available for ${selectedDate.toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric' })}.`, 10, 50);
        return;
    }

    // Ensure labels are Date objects for the time scale
    const chartLabels = dataForDay.map(d => new Date(d.date.getTime())); 
    const uviValues = dataForDay.map(d => d.uvi);

    // Determine chart title date from the first data point
    const chartTitleDisplayDate = new Date(dataForDay[0].date).toLocaleDateString('nl-NL', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Amsterdam'});

    const initialChartHour = manualTimeIndicatorValue ? manualTimeIndicatorValue.getHours() : currentLocalHour;
    
    const initialIndicatorTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), initialChartHour, 0, 0);
    manualTimeIndicatorValue = initialIndicatorTime; 

    window.uvIndexChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels, // Use Date objects as labels
            datasets: [{
                label: 'UV Index',
                data: uviValues,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                segment: {
                    borderColor: ctx => {
                        const uvi = ctx.p1.parsed.y;
                        if (uvi >= 7) return 'red';
                        if (uvi >= 5) return 'orange';
                        if (uvi >= 3) return 'yellow';
                        return 'green';
                    }
                },
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            events: ['mousedown', 'mouseup', 'mousemove', 'mouseout', 'click'],
            scales: {
                x: { // X-axis is Time
                    type: 'time',
                    time: {
                        unit: 'hour',
                        tooltipFormat: 'HH:mm', // e.g., 14:00
                        displayFormats: {
                            hour: 'HH:mm' // e.g., 14:00
                        }
                    },
                    title: {
                        display: true,
                        text: `Time (Local - ${selectedDate.toLocaleDateString('nl-NL', {day: '2-digit', month: '2-digit', year: 'numeric'})})`
                    },
                    ticks: {
                        source: 'auto',
                        autoSkip: true,
                        maxTicksLimit: 24 
                    }
                },
                y: { // Y-axis is UV Index
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'UV Index'
                    },
                    max: Math.max(10, ...uviValues, 0) + 1
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: `UV Index for ${chartTitleDisplayDate} (The Netherlands)`
                },
                tooltip: {
                    callbacks: {
                        title: function(tooltipItems) {
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) label += context.parsed.y.toFixed(2);
                            return label;
                        }
                    }
                }
            }
        },
        plugins: [manualTimeIndicatorPlugin] // Add our custom plugin here
    });

    // Add canvas event listeners for dragging the manual line
    addManualLineDragListeners(canvas, window.uvIndexChart);

    console.log("Chart rendered with manual time indicator for date:", selectedDate.toDateString());
}

function addManualLineDragListeners(canvas, chartInstance) {
    let initialMouseX = null;
    let latestMouseEvent = null;
    let isDragUpdateScheduled = false;

    function performDragUpdate() {
        if (!latestMouseEvent || !isDraggingLine || !chartInstance) {
            isDragUpdateScheduled = false;
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const currentMouseX = latestMouseEvent.clientX - rect.left;

        let closestDataPointTime = null;
        let minDistance = Infinity;

        if (chartInstance.data.labels && chartInstance.data.labels.length > 0) {
            chartInstance.data.labels.forEach((timestamp, index) => {
                const pointX = chartInstance.scales.x.getPixelForValue(timestamp);
                const distance = Math.abs(currentMouseX - pointX);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestDataPointTime = timestamp;
                }
            });
        }

        if (closestDataPointTime === null) {
            // console.warn('Could not find a closest data point.'); // Ensure this is commented
            isDragUpdateScheduled = false;
            return;
        }
        
        manualTimeIndicatorValue = new Date(closestDataPointTime);
        // console.log(`MouseX: ${currentMouseX}, SnappedTime (during drag): ${manualTimeIndicatorValue.toISOString()}`); // Commented out
        
        // DURING DRAG: ONLY UPDATE THE CHART TO MOVE THE LINE
        chartInstance.update('none'); 
        isDragUpdateScheduled = false;
    }

    canvas.onmousedown = (event) => {
        if (!chartInstance || !manualTimeIndicatorValue) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const lineXPos = chartInstance.scales.x.getPixelForValue(manualTimeIndicatorValue);

        if (Math.abs(mouseX - lineXPos) <= timeIndicatorHitboxWidth) {
            isDraggingLine = true;
            latestMouseEvent = event; 
            canvas.style.cursor = 'grabbing';
            stopAutoTimeSliderAnimation();
            // console.log('Manual line drag started'); // Commented out
        }
    };

    canvas.onmousemove = (event) => {
        if (!chartInstance || !manualTimeIndicatorValue) return; // Ensure chart and value exist

        if (isDraggingLine) {
            latestMouseEvent = event;
            if (!isDragUpdateScheduled) {
                isDragUpdateScheduled = true;
                requestAnimationFrame(performDragUpdate);
            }
        } else {
            // Not dragging, so check for hover to change cursor
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const lineXPos = chartInstance.scales.x.getPixelForValue(manualTimeIndicatorValue);

            if (Math.abs(mouseX - lineXPos) <= timeIndicatorHitboxWidth) {
                canvas.style.cursor = 'pointer';
            } else {
                canvas.style.cursor = 'default';
            }
        }
    };

    const stopDragging = () => {
        if (isDraggingLine) {
            isDraggingLine = false;
            // Check if still hovering after drag stop to set pointer, otherwise default
            if (latestMouseEvent && chartInstance && manualTimeIndicatorValue) {
                 const rect = canvas.getBoundingClientRect();
                 const mouseX = latestMouseEvent.clientX - rect.left;
                 const lineXPos = chartInstance.scales.x.getPixelForValue(manualTimeIndicatorValue);
                 if (Math.abs(mouseX - lineXPos) <= timeIndicatorHitboxWidth) {
                    canvas.style.cursor = 'pointer';
                 } else {
                    canvas.style.cursor = 'default';
                 }
            } else {
                canvas.style.cursor = 'default';
            }
            latestMouseEvent = null;
            isDragUpdateScheduled = false; 
            // console.log('Manual line drag ended. Final Time:', manualTimeIndicatorValue ? manualTimeIndicatorValue.toISOString() : 'N/A'); // Commented out

            // ON DRAG END: UPDATE ALL OTHER UI ELEMENTS
            if (manualTimeIndicatorValue) {
                const finalHour = manualTimeIndicatorValue.getHours();
                
                // const timeSlider = document.getElementById('timeSlider'); // REMOVE
                // if (timeSlider.value !== String(finalHour)) { // REMOVE
                //     timeSlider.value = finalHour; // REMOVE
                // }
                const selectedTimeLabel = document.getElementById('selectedTimeLabel');
                if (selectedTimeLabel) {
                    selectedTimeLabel.textContent = `${String(finalHour).padStart(2, '0')}:00 (Local)`;
                }
                setOverlayColorImmediately(finalHour);
                const uviForHour = getUviForHour(finalHour);
                updateSliderUviDisplay(uviForHour);
            }
        }
    };

    canvas.onmouseup = stopDragging;
    canvas.onmouseout = (event) => { // Stop dragging if mouse leaves canvas
        const rect = canvas.getBoundingClientRect();
        if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) {
            stopDragging();
        }
    };
}

function updateDailyPeak(dataForDay) {
    const dailyPeakUVIElement = document.getElementById('dailyPeakUVI');
    if (!dataForDay || dataForDay.length === 0) {
        dailyPeakUVIElement.textContent = "Daily Peak: N/A";
        return;
    }

    // Find the maximum UVI from the generated hourly data for the day
    const peakUviValue = Math.max(...dataForDay.map(d => d.uvi), 0);
    
    if (peakUviValue > 0) {
        // Find the time of the peak. There might be multiple hours with the same peak if flat, take the first.
        const peakEntry = dataForDay.find(d => d.uvi === peakUviValue);
        const peakTime = new Date(peakEntry.date);
        // Display time in local timezone
        const peakTimeLocal = new Date(peakTime.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
        const peakHourLocal = String(peakTimeLocal.getHours()).padStart(2, '0');
        const peakMinuteLocal = String(peakTimeLocal.getMinutes()).padStart(2, '0');

        dailyPeakUVIElement.textContent = `Daily Peak: ${peakUviValue.toFixed(1)} at ${peakHourLocal}:${peakMinuteLocal} (Local)`;
    } else {
        dailyPeakUVIElement.textContent = "Daily Peak: 0.0";
    }
}

function getRecommendation(uvi) {
    if (uvi <= 2) return "Minimal risk - enjoy outdoor activities";
    if (uvi <= 4) return "Moderate risk - wear sunglasses and sunscreen";
    if (uvi <= 6) return "High risk - seek shade 12:00-15:00, use SPF 30+";
    return "Very high risk - avoid direct sun, full protection required";
}

function updateCurrentStatus(allDailyPeakData, selectedDate) {
    const currentUVIElement = document.getElementById('currentUVI');
    const currentRecommendationElement = document.getElementById('currentRecommendation');

    if (!selectedDate || !currentHourlyDataForDay || currentHourlyDataForDay.length === 0) {
        currentUVIElement.textContent = "Latest UVI: N/A";
        currentRecommendationElement.textContent = "No data available for the selected date.";
        if (bilthovenUviMarker) bilthovenUviMarker.setIcon(L.divIcon({ className: 'bilthoven-uvi-label', html: 'UVI: N/A', iconSize: [80, 25] }));
        return;
    }

    // Use currentLocalHour (which is in Amsterdam time) to find the corresponding UTC hour
    // The selectedDate is UTC noon. We need to find the UVI for currentLocalHour on that selectedDate.

    const amsterdamNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
    const selectedDateParts = {
        year: selectedDate.getUTCFullYear(),
        month: selectedDate.getUTCMonth(),
        day: selectedDate.getUTCDate()
    };

    // Is the selected date "today" in Amsterdam timezone?
    const isSelectedDateTodayAmsterdam = 
        selectedDateParts.year === amsterdamNow.getFullYear() &&
        selectedDateParts.month === amsterdamNow.getMonth() &&
        selectedDateParts.day === amsterdamNow.getDate();

    let relevantHourForUvi = currentLocalHour; // Use slider's hour by default
    
    // If selected date is today, use the actual current hour in Amsterdam for status, otherwise use slider hour
    if (isSelectedDateTodayAmsterdam) {
        relevantHourForUvi = amsterdamNow.getHours();
    }


    // Find the UVI data for this relevantHourForUvi in currentHourlyDataForDay
    // currentHourlyDataForDay has dates in UTC.
    // We need to find the entry where the UTC hour corresponds to relevantHourForUvi in Amsterdam time on selectedDate.
    
    let uviForCurrentHour = null;
    let foundEntry = null;

    for (const hourlyEntry of currentHourlyDataForDay) {
        const entryDateUtc = new Date(hourlyEntry.date);
        // Convert this UTC entry time to Amsterdam time
        const entryDateAmsterdam = new Date(entryDateUtc.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
        
        // Check if this entry's Amsterdam date matches the core selected date (ignoring time)
        // and if its Amsterdam hour matches the relevantHourForUvi
        if (entryDateAmsterdam.getFullYear() === selectedDateParts.year &&
            entryDateAmsterdam.getMonth() === selectedDateParts.month &&
            entryDateAmsterdam.getDate() === selectedDateParts.day &&
            entryDateAmsterdam.getHours() === relevantHourForUvi) {
            uviForCurrentHour = hourlyEntry.uvi;
            foundEntry = hourlyEntry;
            break;
        }
    }


    if (uviForCurrentHour !== null && uviForCurrentHour !== undefined) {
        currentUVIElement.textContent = `UVI at ${String(relevantHourForUvi).padStart(2, '0')}:00 (Local): ${uviForCurrentHour.toFixed(1)}`;
        currentRecommendationElement.textContent = getRecommendation(uviForCurrentHour);
        if (bilthovenUviMarker) {
             bilthovenUviMarker.setIcon(L.divIcon({
                className: 'bilthoven-uvi-label',
                html: `UVI: ${uviForCurrentHour.toFixed(1)}`,
                iconSize: [80, 25]
            }));
        }
    } else {
        // Fallback if no exact hour match (shouldn't happen if data is generated for all 24h)
        currentUVIElement.textContent = "Latest UVI: N/A";
        currentRecommendationElement.textContent = "Data for the current hour not available.";
         if (bilthovenUviMarker) bilthovenUviMarker.setIcon(L.divIcon({ className: 'bilthoven-uvi-label', html: 'UVI: N/A', iconSize: [80, 25] }));
        console.warn(`No UVI data found for ${relevantHourForUvi}:00 local on ${selectedDate.toDateString()} in currentHourlyDataForDay`);
    }
}

function stopCrossFadeAnimation() {
    if (fadeAnimationId) {
        cancelAnimationFrame(fadeAnimationId);
        fadeAnimationId = null;
    }
}

function updateSliderUviDisplay(uviValue) {
    const uviDisplayElement = document.getElementById('sliderHourUVI');
    if (uviDisplayElement) {
        if (uviValue !== null && uviValue !== undefined) {
            uviDisplayElement.textContent = `UVI: ${uviValue.toFixed(2)}`;
        } else {
            uviDisplayElement.textContent = "UVI: --";
        }
    }
    // Update the Bilthoven UVI marker on the map
    if (bilthovenUviMarker) {
        const uviText = (uviValue !== null && uviValue !== undefined) ? uviValue.toFixed(2) : '--';
        bilthovenUviMarker.setIcon(L.divIcon({
            className: 'bilthoven-uvi-label',
            html: `<strong>UVI: ${uviText}</strong>`,
            iconSize: [100, 30], // Adjust if text is larger, keep iconAnchor half of this
            iconAnchor: [50, 15]   // Center of the icon
        }));
    }
}

function setOverlayColorImmediately(localHour) {
    if (!netherlandsLayerA || !netherlandsLayerB) return;
    const uvi = getUviForHour(localHour);
    updateSliderUviDisplay(uvi); // Update UVI display
    const newColor = getUviColor(uvi);
    const newFillOpacity = TARGET_OPACITY;

    if (activeLayerIsA) {
        netherlandsLayerA.setStyle({ fillColor: newColor, fillOpacity: newFillOpacity });
        netherlandsLayerB.setStyle({ fillOpacity: 0 });
    } else {
        netherlandsLayerB.setStyle({ fillColor: newColor, fillOpacity: newFillOpacity });
        netherlandsLayerA.setStyle({ fillOpacity: 0 });
    }
    // console.log(`Immediately set color for hour ${localHour} on layer ${activeLayerIsA ? 'A' : 'B'}`);
}

function crossFadeToUviColor(uviForHour) {
    stopCrossFadeAnimation();
    if (!netherlandsLayerA || !netherlandsLayerB) return;

    updateSliderUviDisplay(uviForHour); // Update UVI display at the start of a potential fade

    const fromLayer = activeLayerIsA ? netherlandsLayerA : netherlandsLayerB;
    const toLayer = activeLayerIsA ? netherlandsLayerB : netherlandsLayerA;
    const targetColor = getUviColor(uviForHour);
    const currentFromLayerStyle = fromLayer.options.style || {};

    if (currentFromLayerStyle.fillColor === targetColor && 
        currentFromLayerStyle.fillOpacity === TARGET_OPACITY) {
        toLayer.setStyle({ fillOpacity: 0 });
        return; 
    }

    // Prepare the toLayer (which is currently hidden) for its fade-in
    toLayer.setStyle({ 
        fillColor: targetColor, 
        fillOpacity: 0 
    });

    // Ensure the fromLayer (currently visible) starts at its full TARGET_OPACITY for a proper fade-out
    // This is important if a previous fade was interrupted or if its opacity wasn't at TARGET_OPACITY.
    fromLayer.setStyle({ 
        fillOpacity: TARGET_OPACITY 
    });

    let startTime = null;
    function animateStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / FADE_DURATION, 1);

        fromLayer.setStyle({ fillOpacity: TARGET_OPACITY * (1 - progress) });
        toLayer.setStyle({ fillOpacity: TARGET_OPACITY * progress });

        if (progress < 1) {
            fadeAnimationId = requestAnimationFrame(animateStep);
        } else {
            // Animation finished: ensure final states are precise
            fromLayer.setStyle({ fillOpacity: 0 });
            toLayer.setStyle({ fillOpacity: TARGET_OPACITY });
            activeLayerIsA = !activeLayerIsA; // Switch the active layer state
            fadeAnimationId = null;
            // console.log("Fade complete. Active layer is now: ", activeLayerIsA ? "A" : "B");
        }
    }
    fadeAnimationId = requestAnimationFrame(animateStep);
}

function stopAutoTimeSliderAnimation() {
    stopCrossFadeAnimation(); // Also stop any fade animation
    if (animationIntervalId) {
        clearInterval(animationIntervalId);
        animationIntervalId = null;
        // console.log("Time slider animation stopped.");
    }
}

function startAutoTimeSliderAnimation(startHour, isToday) {
    stopAutoTimeSliderAnimation(); 
    const selectedTimeLabel = document.getElementById('selectedTimeLabel');
    if (!selectedTimeLabel) {
        console.warn("selectedTimeLabel not found, cannot start auto animation effectively.");
        return;
    }

    let currentAnimatedHour = startHour !== undefined ? startHour : (manualTimeIndicatorValue ? manualTimeIndicatorValue.getHours() : 12);
    // If it's today, animation should not go beyond the actual current hour in Amsterdam
    const actualCurrentHourAmsterdam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getHours();

    if (isToday && currentAnimatedHour > actualCurrentHourAmsterdam) {
        console.log("Initial animation hour is past current time for today. Animation will not start.");
        // Optionally, set the display to the current actual hour if it makes sense
        // currentAnimatedHour = actualCurrentHourAmsterdam; 
        // Or simply don't start the animation if the startHour is already in the future for today.
        // For now, we will allow it to start but it will stop quickly if the condition below is met immediately.
    }

    if (selectedTimeLabel) selectedTimeLabel.textContent = `${currentAnimatedHour.toString().padStart(2, '0')}:00 (Local)`;
    
    let uvi = getUviForHour(currentAnimatedHour);
    crossFadeToUviColor(uvi); 

    if (window.uvIndexChart) {
        const datePicker = document.getElementById('datePicker');
        const selectedDateString = datePicker ? datePicker.value : null;
        if (selectedDateString) {
            const parts = selectedDateString.split('-');
            manualTimeIndicatorValue = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), currentAnimatedHour, 0, 0);
            window.uvIndexChart.update('none');
        }
    }

    animationIntervalId = setInterval(() => {
        // Condition to stop: if it's today AND animation hour will exceed current actual hour OR if it exceeds 23
        if (isToday && (currentAnimatedHour + 1) > actualCurrentHourAmsterdam) {
            console.log("Auto-slider stopping: Reached current hour for today or end of day.");
            stopAutoTimeSliderAnimation();
            return;
        }
        if ((currentAnimatedHour + 1) > 23) {
            console.log("Auto-slider stopping: Reached end of day (23:00).");
            stopAutoTimeSliderAnimation();
            return;
        }

        currentAnimatedHour++;
        
        if (selectedTimeLabel) selectedTimeLabel.textContent = `${currentAnimatedHour.toString().padStart(2, '0')}:00 (Local)`;
        
        if (window.uvIndexChart) {
            const datePicker = document.getElementById('datePicker');
            const selectedDateString = datePicker ? datePicker.value : null;
            if (selectedDateString) {
                const parts = selectedDateString.split('-');
                manualTimeIndicatorValue = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), currentAnimatedHour, 0, 0);
                window.uvIndexChart.update('none');
            }
        }

        uvi = getUviForHour(currentAnimatedHour);
        crossFadeToUviColor(uvi);
    }, 2000); 
}

// Helper function to get UVI for a given hour (extracted from setOverlayColorImmediately)
function getUviForHour(localHour) {
    // localHour is an hour in the Europe/Amsterdam timezone for the selected day.
    // currentHourlyDataForDay contains UTC-timed data for the selected day.

    if (!currentHourlyDataForDay || currentHourlyDataForDay.length === 0) {
        // console.warn("getUviForHour: currentHourlyDataForDay is empty.");
        return 0; // Default to 0 if no data
    }

    // We need to find the entry in currentHourlyDataForDay (UTC)
    // whose Amsterdam time equivalent hour matches localHour.
    
    // Get the date part of the currently selected day (from date picker or initialDateToDisplay)
    // This should be based on the date for which currentHourlyDataForDay was generated.
    // Assuming currentHourlyDataForDay[0].date gives a reference UTC date for the day.
    const referenceUtcDate = new Date(currentHourlyDataForDay[0].date);

    for (const hourlyEntry of currentHourlyDataForDay) {
        const entryDateUtc = new Date(hourlyEntry.date);
        // Convert this UTC entry time to Amsterdam time
        const entryDateAmsterdam = new Date(entryDateUtc.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));

        // Check if the date part matches and the hour matches
        if (entryDateAmsterdam.getUTCFullYear() === referenceUtcDate.getUTCFullYear() && // Compare UTC parts to be safe
            entryDateAmsterdam.getUTCMonth() === referenceUtcDate.getUTCMonth() &&
            entryDateAmsterdam.getUTCDate() === referenceUtcDate.getUTCDate() &&
            entryDateAmsterdam.getHours() === localHour) {
            // console.log(`getUviForHour(${localHour}): Found UVI ${hourlyEntry.uvi}`);
            return hourlyEntry.uvi;
        }
    }
    // console.warn(`getUviForHour: No UVI found for local hour ${localHour}. Defaulting to 0.`);
    return 0; // Default if no specific data point found for that hour
}

// Initialize the application once the entire page is fully loaded (including scripts)
window.addEventListener('load', initializeApp);

// Wait for the DOM to be fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', () => {
    const toggleButton = document.getElementById('togglePanelBtn');
    // The panel now has 'collapsible-panel' class added directly in HTML
    const panel = document.querySelector('.ui-overlay-panel.collapsible-panel');

    if (toggleButton && panel) {
        toggleButton.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            // Optional: Change button text based on state
            if (panel.classList.contains('collapsed')) {
                toggleButton.textContent = 'Show Controls';
            } else {
                toggleButton.textContent = 'Hide Controls';
            }
        });

        // Optional: Set initial button text if you want it to start collapsed by default via HTML class
        // if (panel.classList.contains('collapsed')) {
        //     toggleButton.textContent = 'Show Controls';
        // } else {
        //     toggleButton.textContent = 'Hide Controls'; // Default if not starting collapsed
        // }
        // Set initial text to 'Hide Controls' as it's visible by default
        toggleButton.textContent = 'Hide Controls';

    } else {
        if (!toggleButton) console.error('Toggle button #togglePanelBtn not found.');
        if (!panel) console.error('Collapsible panel .ui-overlay-panel.collapsible-panel not found.');
    }
}); 