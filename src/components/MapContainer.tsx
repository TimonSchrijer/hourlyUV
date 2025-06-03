'use client';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import mapboxgl, { Map as MapboxMap, Marker, Popup } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getUVRisk, UVRisk } from '@/utils/uvUtils';
import { HourlyUvData, Station, UvDataPoint } from '@/types';
import SafePlayTimes from './SafePlayTimes';
import TimeSlider from './TimeSlider';

const NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

interface MapContainerProps {}

const MapContainer: React.FC<MapContainerProps> = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [allUvData, setAllUvData] = useState<UvDataPoint[]>([]);
  const [selectedHourData, setSelectedHourData] = useState<UvDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number>(new Date().getHours());
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/streets-v11');
  const popUpRef = useRef<Popup | null>(null);

  useEffect(() => {
    if (!NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) {
      setError('Mapbox access token is not configured. Please set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in .env.local');
      setIsLoading(false);
      return;
    }
    mapboxgl.accessToken = NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/uv-data');
        if (!response.ok) {
          let errorMsg = `Failed to fetch data: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorData.error || errorMsg;
          } catch (e) { /* Ignore parsing error, use status code message */ }
          throw new Error(errorMsg);
        }
        
        const result = await response.json();

        let currentUvData: HourlyUvData[];
        if (result.mockUvDataUsed) {
          console.warn('API returned mock UV data:', result.message);
          currentUvData = result.uvData;
        } else {
          currentUvData = result.uvData;
        }

        const stationsData: Station[] = result.stationMetadata || [];

        if (!Array.isArray(currentUvData)) {
          console.error('UV data is not an array:', currentUvData);
          throw new Error('Received invalid UV data format from API.');
        }
        if (!Array.isArray(stationsData)) {
          console.error('Stations data is not an array:', stationsData);
          throw new Error('Received invalid Stations data format from API.');
        }
        
        const stationsMap = new window.Map<string, Station>();
        stationsData.forEach(station => {
          stationsMap.set(station.StationID, station);
        });

        const processedUvData: UvDataPoint[] = currentUvData.map(uvRecord => {
          const stationInfo = stationsMap.get(uvRecord.stationId);
          if (!stationInfo) {
            console.warn(`Station info not found for ID: ${uvRecord.stationId}`);
            return null; 
          }
          return {
            ...uvRecord,
            latitude: parseFloat(stationInfo["LAT(deg)"]),
            longitude: parseFloat(stationInfo["LON(deg)"]),
            name: stationInfo.Location,
          };
        }).filter(Boolean) as UvDataPoint[];

        setAllUvData(processedUvData);
      } catch (e: any) {
        console.error('Error fetching data:', e);
        setError(e.message || 'An unknown error occurred while fetching data.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []); // Empty dependency array: fetch data once on mount

  useEffect(() => {
    if (!mapRef.current && mapContainerRef.current && allUvData.length > 0) {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: mapStyle,
        center: [5.2913, 52.1326], // Netherlands center
        zoom: 7,
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl());
      mapRef.current.addControl(new mapboxgl.FullscreenControl());
      mapRef.current.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true
      }));
    }

    // Update markers when selected hour or data changes
    if (mapRef.current && selectedHourData.length > 0) {
      // Clear existing custom markers (circles)
      document.querySelectorAll('.custom-marker').forEach(marker => marker.remove());
      if (popUpRef.current) {
        popUpRef.current.remove();
        popUpRef.current = null;
      }

      selectedHourData.forEach(point => {
        const risk = getUVRisk(point.uvIndex);
        const el = document.createElement('div');
        el.className = 'custom-marker';
        el.style.backgroundColor = risk.color;
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.borderRadius = '50%';
        el.style.border = '2px solid white';
        el.style.cursor = 'pointer';

        const marker = new mapboxgl.Marker(el)
          .setLngLat([point.longitude, point.latitude])
          .addTo(mapRef.current!);

        marker.getElement().addEventListener('mouseenter', () => {
          if (popUpRef.current) popUpRef.current.remove(); // Remove existing popup
          const popupContent = `
            <div>
              <h3>${point.name}</h3>
              <p><strong>UV Index:</strong> ${point.uvIndex} (${risk.level})</p>
              <p><strong>Time:</strong> ${new Date(point.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              <p><strong>Advice:</strong> ${risk.advice}</p>
            </div>
          `;
          popUpRef.current = new mapboxgl.Popup({ closeButton: false, offset: 25 })
            .setLngLat([point.longitude, point.latitude])
            .setHTML(popupContent)
            .addTo(mapRef.current!);
        });

        marker.getElement().addEventListener('mouseleave', () => {
          if (popUpRef.current) {
            popUpRef.current.remove();
            popUpRef.current = null;
          }
        });
      });
    }
  }, [allUvData, selectedHourData, mapStyle]);

  useEffect(() => {
    // Filter data for the selected hour
    const currentHourISO = new Date();
    currentHourISO.setHours(selectedHour, 0, 0, 0);
    const hourISOString = currentHourISO.toISOString().substring(0, 13); // Compare YYYY-MM-DDTHH

    const filtered = allUvData.filter(point => {
      return point.hour.substring(0, 13) === hourISOString;
    });
    setSelectedHourData(filtered);
  }, [allUvData, selectedHour]);
  
  const handleHourChange = (hour: number) => {
    setSelectedHour(hour);
  };

  const handleStyleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newStyle = event.target.value;
    setMapStyle(newStyle);
    if (mapRef.current) {
      mapRef.current.setStyle(newStyle);
    }
  };

  if (!NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) {
    return (
      <div className="flex items-center justify-center h-screen bg-red-100 text-red-700 p-4">
        <p className="text-xl font-semibold">Configuration Error: Mapbox access token is missing.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-red-100 text-red-700 p-4">
        <p className="text-xl font-semibold">Error: {error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
        <p className="ml-4 text-xl">Loading UV Data...</p>
      </div>
    );
  }

  return (
    <div className="relative h-screen">
      <div ref={mapContainerRef} className="absolute top-0 bottom-0 w-full" />
      <div className="absolute top-4 left-4 bg-white p-4 rounded shadow-lg z-10">
        <h2 className="text-lg font-semibold mb-2">UV Index Map</h2>
        <div className="mb-4">
          <label htmlFor="mapStyle" className="block text-sm font-medium text-gray-700">Map Style:</label>
          <select id="mapStyle" value={mapStyle} onChange={handleStyleChange} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
            <option value="mapbox://styles/mapbox/streets-v11">Streets</option>
            <option value="mapbox://styles/mapbox/outdoors-v11">Outdoors</option>
            <option value="mapbox://styles/mapbox/light-v10">Light</option>
            <option value="mapbox://styles/mapbox/dark-v10">Dark</option>
            <option value="mapbox://styles/mapbox/satellite-v9">Satellite</option>
            <option value="mapbox://styles/mapbox/satellite-streets-v11">Satellite Streets</option>
          </select>
        </div>
        <TimeSlider currentHour={selectedHour} onHourChange={handleHourChange} />
        <SafePlayTimes hourlyData={selectedHourData} /> 
      </div>
    </div>
  );
};

export default MapContainer;