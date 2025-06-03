import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { parse as dateParse, startOfHour, formatISO, isValid, subDays, format as formatDateFns, getYear, isEqual, startOfDay } from 'date-fns';
// import { nl } from 'date-fns/locale'; // Not strictly needed for dd-MM-yyyy HH:mm parsing

// Define a type for the raw RIVM CSV data structure
interface RawRIVMData {
  Datum: string; // Format like "DD-MM-YYYY"
  Tijd: string;  // Format like "HH:MM" (assume MEST/MET)
  StationID: string;
  Meting: string; // UV Index
  Status?: string; // Often a quality indicator, e.g., 'OK'
  Verwachting?: string; // Forecasted UV index
  // InstrumentID might also be present
}

// Define a type for our processed hourly data
export interface HourlyUvData {
  hour: string; // ISO 8601 format, e.g., "2025-05-28T00:00:00Z"
  uvIndex: number;
  stationId: string;
}

// Interface for RIVM Station Metadata
interface RivmStationInfo {
  StationID: string;
  "LON(deg)": string;
  "LAT(deg)": string;
  NAAM: string; // Assuming the key is NAAM for station name
  ALT: string;
  Provincie: string;
  // Add other fields if they exist and are needed
}

// Combined response type
interface UvDataApiResponse {
  uvData: HourlyUvData[];
  stationMetadata: RivmStationInfo[];
  mockUvDataUsed: boolean;
  message?: string;
  error?: string;
  errorDetails?: string | null;
}

// Cache for API responses
let cache = {
  timestamp: 0,
  data: null as UvDataApiResponse | null, // Cache the combined response
};
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const RIVM_STATIONS_METADATA_URL = 'https://data.rivm.nl/meta/zonkracht/meta_stations.json';

// Mock station metadata for stations used in mock UV data, if real metadata is missing.
const MOCK_STATIONS_DEFINITIONS: RivmStationInfo[] = [
    { StationID: '260', "LON(deg)": "5.177", "LAT(deg)": "52.098", NAAM: "De Bilt (Mocked)", ALT: "2", Provincie: "Utrecht" },
    { StationID: '280', "LON(deg)": "5.387", "LAT(deg)": "51.447", NAAM: "Eindhoven (Mocked)", ALT: "20", Provincie: "Noord-Brabant" }
];

// Helper to generate RIVM URL for a given year
function getRivmApiUrlForYear(year: number): string {
  const currentYear = getYear(new Date());
  let filename = '';
  if (year === currentYear) {
    // For the current year, the pattern is ZonkrachtYYYY.txt
    filename = `Zonkracht${year}.txt`;
  } else {
    // For previous years, the pattern seems to be ZonkrachtRIVMYYYY.txt
    filename = `ZonkrachtRIVM${year}.txt`;
  }
  return `https://data.rivm.nl/data/zonkracht/${filename}`;
}

async function fetchStationMetadata(): Promise<RivmStationInfo[]> {
  try {
    console.log(`Fetching station metadata from: ${RIVM_STATIONS_METADATA_URL}`);
    const response = await fetch(RIVM_STATIONS_METADATA_URL);
    if (!response.ok) {
      console.error(`Failed to fetch station metadata: ${response.status} ${response.statusText}. Response:`, await response.text());
      return []; // Return empty array on error
    }
    const metadata = await response.json();
    console.log(`Successfully fetched ${metadata.length} station metadata entries.`);
    if (metadata.length > 0) {
        // console.log('Raw station metadata JSON:', JSON.stringify(metadata)); // Can be very verbose
        console.log('Example fetched station metadata entry:', JSON.stringify(metadata[0]));
        const stationIds = metadata.map((s: RivmStationInfo) => s.StationID);
        console.log(`Fetched station IDs: [${stationIds.join(', ')}]`);
    }
    return metadata as RivmStationInfo[];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching or parsing station metadata:', errorMessage, error);
    return []; // Return empty array on error
  }
}

export async function GET(request: Request) {
  console.log('API route /api/uv-data called');

  const now = Date.now();
  if (now - cache.timestamp < CACHE_DURATION_MS && cache.data) {
    console.log('Returning cached combined data');
    return NextResponse.json(cache.data);
  }

  let fetchedStationMetadata: RivmStationInfo[] = await fetchStationMetadata();
  console.log(`Received ${fetchedStationMetadata.length} station metadata entries from fetchStationMetadata.`);


  let responseUvData: HourlyUvData[];
  let responseMessage: string | undefined;
  let responseError: string | undefined;
  let responseErrorDetails: string | null | undefined;
  let responseMockUvUsed: boolean = false;
  let httpStatus: number = 200;
  let csvText: string | null = null; 

  try {
    const currentDate = new Date();
    const currentYear = getYear(currentDate);
    const previousYear = currentYear - 1;

    let fetchedUrl = '';
    let targetDateToFilter = subDays(currentDate, 1); 

    const urlCurrentYear = getRivmApiUrlForYear(currentYear);
    console.log(`Attempting to fetch RIVM UV data from: ${urlCurrentYear} for date ${formatDateFns(targetDateToFilter, 'dd-MM-yyyy')}`);
    try {
      const response = await fetch(urlCurrentYear);
      if (response.ok) {
        csvText = await response.text();
        fetchedUrl = urlCurrentYear;
        console.log(`Successfully fetched data from ${urlCurrentYear}`);
      } else {
        console.warn(`Failed to fetch from ${urlCurrentYear}: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      console.warn(`Error fetching from ${urlCurrentYear}:`, e);
    }

    if (!csvText || csvText.trim().length < 1000) { // Heuristic for empty file
      console.log(`Current year file from ${urlCurrentYear} (target date ${formatDateFns(targetDateToFilter, 'dd-MM-yyyy')}) seems empty or fetch failed. Attempting previous year.`);
      const urlPreviousYear = getRivmApiUrlForYear(previousYear);
      // If we are using previous year's file, filter for Dec 31 of that year
      const previousYearTargetDate = dateParse(`${previousYear}-12-31`, 'yyyy-MM-dd', new Date());
      console.log(`Attempting to fetch RIVM UV data from: ${urlPreviousYear} for date ${formatDateFns(previousYearTargetDate, 'dd-MM-yyyy')}`);
      try {
        const response = await fetch(urlPreviousYear);
        if (response.ok) {
          csvText = await response.text();
          fetchedUrl = urlPreviousYear;
          targetDateToFilter = previousYearTargetDate; // Update targetDateToFilter if using previous year's data
          console.log(`Successfully fetched data from ${urlPreviousYear}. Will filter for ${formatDateFns(targetDateToFilter, 'dd-MM-yyyy')}`);
        } else {
          console.warn(`Failed to fetch from ${urlPreviousYear}: ${response.status} ${response.statusText}`);
        }
      } catch (e) {
        console.warn(`Error fetching from ${urlPreviousYear}:`, e);
      }
    }
    
    if (csvText) {
      const processingResult = processRivmCsvDataInternal(csvText, fetchedUrl, targetDateToFilter);
      responseUvData = processingResult.data;
      responseMockUvUsed = processingResult.mockUvDataUsed;
      responseMessage = processingResult.message;
      responseError = processingResult.error;
      httpStatus = processingResult.error ? 500 : (processingResult.mockUvDataUsed ? 200 : 200) ;
    } else {
      const reason = 'All RIVM UV data fetch attempts failed (current and previous year).';
      console.warn(reason);
      const mockUv = generateMockUvData(reason, false);
      responseUvData = mockUv.data;
      responseMockUvUsed = true;
      responseMessage = mockUv.message;
      httpStatus = 200; 
    }

  } catch (error) {
    console.error('Critical error in /api/uv-data GET handler logic:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown critical error occurred during UV data processing';
    const errorStack = error instanceof Error ? error.stack : null;
    const mockUv = generateMockUvData(errorMessage, true, errorStack);
    
    responseUvData = mockUv.data;
    responseMockUvUsed = true;
    responseMessage = mockUv.message;
    responseError = errorMessage;
    responseErrorDetails = errorStack;
    httpStatus = 500; 
  }

  let finalStationMetadata = [...fetchedStationMetadata];
  if (responseMockUvUsed) {
    console.log('Mock UV data is used. Checking if mock station metadata needs to be added.');
    MOCK_STATIONS_DEFINITIONS.forEach(mockStationDef => {
      if (responseUvData.some(d => d.stationId === mockStationDef.StationID)) {
        if (!finalStationMetadata.some(s => s.StationID === mockStationDef.StationID)) {
          finalStationMetadata.push(mockStationDef);
          console.log(`Added fallback mock metadata for station ${mockStationDef.StationID} (${mockStationDef.NAAM}) as it was missing from fetched metadata and is used in mock UV data.`);
        } else {
          console.log(`Station ${mockStationDef.StationID} (${mockStationDef.NAAM}) from mock definitions is already present in fetched metadata.`);
        }
      }
    });
  }
  
  const finalStationIds = finalStationMetadata.map(s => s.StationID);
  console.log(`Final station metadata IDs for response: [${finalStationIds.join(', ')}]. Total: ${finalStationMetadata.length}`);
  if (responseMockUvUsed) {
    MOCK_STATIONS_DEFINITIONS.forEach(mockStationDef => {
        if (responseUvData.some(d => d.stationId === mockStationDef.StationID)) {
             console.log(`For mock UV station ${mockStationDef.StationID}, is metadata present in final list? ${finalStationIds.includes(mockStationDef.StationID)}`);
        }
    });
  }

  const apiResponse: UvDataApiResponse = {
      uvData: responseUvData,
      stationMetadata: finalStationMetadata,
      mockUvDataUsed: responseMockUvUsed,
      message: responseMessage,
      error: responseError,
      errorDetails: responseErrorDetails,
  };

  if (httpStatus !== 500) {
      cache = { timestamp: Date.now(), data: apiResponse };
      console.log('Updated cache with new API response.');
  }
  
  return NextResponse.json(apiResponse, { status: httpStatus });
}

// Renamed and adapted from previous generateMockDataResponse
interface MockUvResult {
    data: HourlyUvData[];
    message: string;
    mockUvDataUsed: true; // This field is inherent to this function's purpose
    error?: string;
    errorDetails?: string | null;
}

function generateMockUvData(reason: string, isUnexpectedError: boolean = false, errorStack?: string | null): MockUvResult {
  console.warn(`Generating mock UV data. Reason: ${reason}`);
  const mockData: HourlyUvData[] = [
    { hour: formatISO(startOfHour(new Date())), uvIndex: 3, stationId: '260' }, 
    { hour: formatISO(startOfHour(new Date())), uvIndex: 5, stationId: '280' }, 
    { hour: formatISO(startOfHour(subDays(new Date(), 1))), uvIndex: 1, stationId: '260' }, 
    { hour: formatISO(startOfHour(new Date(new Date().getTime() - 3600 * 1000 * 3))), uvIndex: 2, stationId: '280' } // Changed to 280 for variety
  ];
  
  return {
    data: mockData,
    message: `Fallback to mock UV data. Reason: ${reason}`,
    mockUvDataUsed: true,
    error: isUnexpectedError ? reason : undefined,
    errorDetails: isUnexpectedError && errorStack ? errorStack : undefined,
  };
}

// Renamed and adapted from previous processRivmCsvData
// This now returns a structure including processed data or mock data indication
interface ProcessedUvResult {
    data: HourlyUvData[];
    mockUvDataUsed: boolean;
    message?: string;
    error?: string;
}

function processRivmCsvDataInternal(csvText: string, sourceUrl: string, targetDate: Date): ProcessedUvResult {
    if (!csvText || csvText.trim().length === 0) {
        const reason = `RIVM TXT file from ${sourceUrl} is effectively empty.`;
        console.warn(reason);
        const mockResult = generateMockUvData(reason, false); // Generate mock data
        return { // Adapt to ProcessedUvResult structure
            data: mockResult.data,
            mockUvDataUsed: true,
            message: mockResult.message,
            error: mockResult.error 
        };
    }

    const parseConfig = {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false, 
      comments: '#',
    };

    let parseResult = Papa.parse<RawRIVMData>(csvText, { ...parseConfig, delimiter: ',' });

    if (parseResult.errors.length > 0 || parseResult.data.length === 0) {
      console.warn(`RIVM TXT parsing errors with comma delimiter from ${sourceUrl} (or no data). Errors: ${JSON.stringify(parseResult.errors)}. Attempting semicolon...`);
      parseResult = Papa.parse<RawRIVMData>(csvText, { ...parseConfig, delimiter: ';' });
      
      if (parseResult.errors.length > 0 || parseResult.data.length === 0) {
         const reason = `RIVM TXT parsing failed (both comma and semicolon) from ${sourceUrl}. Errors: ${JSON.stringify(parseResult.errors)}`;
         console.error(reason);
         const mockResult = generateMockUvData(reason, true); // Parsing failure is an unexpected error for real data processing
         return { 
            data: mockResult.data,
            mockUvDataUsed: true,
            message: mockResult.message,
            error: mockResult.error 
         };
      }
      console.log('Successfully parsed RIVM TXT with semicolon delimiter.');
    } else {
      console.log('Successfully parsed RIVM TXT with comma delimiter.');
    }
    
    // Filter, validate, and process the parsed data
    const allRecords = parseResult.data;
    console.log(`Parsed ${allRecords.length} records from ${sourceUrl}. Filtering for target date: ${formatDateFns(targetDate, 'dd-MM-yyyy')}`);

    const stationHourlyTotals: Record<string, Record<string, { sum: number; count: number }>> = {};
    let validRecordsForDate = 0;

    const targetDateStart = startOfDay(targetDate);

    allRecords.forEach((record, index) => {
      if (!record.Datum || !record.Tijd || !record.StationID || record.Meting === undefined || record.Meting === null) {
        // console.warn(`Skipping record ${index + 2} due to missing critical fields: `, record);
        return;
      }

      // Robust date parsing: try multiple formats or be very specific if one is known
      // Example: "dd-MM-yyyy" and "HH:mm"
      // The RIVM data seems to use "dag-maand-jaar" e.g. "01-01-2024"
      let recordDate: Date;
      try {
        recordDate = dateParse(`${record.Datum} ${record.Tijd}`, 'dd-MM-yyyy HH:mm', new Date());
      } catch (e) {
        // console.warn(`Could not parse date for record ${index + 2}: ${record.Datum} ${record.Tijd}`);
        return;
      }

      if (!isValid(recordDate)) {
        // console.warn(`Skipping record ${index + 2} due to invalid date: ${record.Datum} ${record.Tijd}`);
        return;
      }
      
      // Compare day, month, and year of recordDate with targetDate
      if (!isEqual(startOfDay(recordDate), targetDateStart)) {
        // console.log(`Skipping record for ${formatDateFns(recordDate, 'dd-MM-yyyy')} as it does not match target ${formatDateFns(targetDate, 'dd-MM-yyyy')}`);
        return;
      }
      validRecordsForDate++;

      const uvIndex = parseFloat(record.Meting.replace(',', '.')); // Handle both . and , as decimal
      if (isNaN(uvIndex) || uvIndex < 0 || uvIndex > 20) { // Basic UV validation
        // console.warn(`Skipping record ${index + 2} due to invalid UV value: ${record.Meting}`);
        return;
      }

      const hourKey = formatISO(startOfHour(recordDate));
      const stationId = record.StationID.trim();

      if (!stationHourlyTotals[stationId]) {
        stationHourlyTotals[stationId] = {};
      }
      if (!stationHourlyTotals[stationId][hourKey]) {
        stationHourlyTotals[stationId][hourKey] = { sum: 0, count: 0 };
      }
      stationHourlyTotals[stationId][hourKey].sum += uvIndex;
      stationHourlyTotals[stationId][hourKey].count++;
    });
    
    console.log(`Found ${validRecordsForDate} valid records for the target date ${formatDateFns(targetDate, 'dd-MM-yyyy')} before hourly aggregation.`);

    const processedData: HourlyUvData[] = [];
    for (const stationId in stationHourlyTotals) {
      for (const hourKey in stationHourlyTotals[stationId]) {
        const { sum, count } = stationHourlyTotals[stationId][hourKey];
        processedData.push({
          hour: hourKey,
          uvIndex: sum / count,
          stationId: stationId,
        });
      }
    }
    
    console.log(`Processed ${processedData.length} hourly UV data points from ${sourceUrl} for ${formatDateFns(targetDate, 'dd-MM-yyyy')}.`);

    if (processedData.length === 0) {
      const reason = `No RIVM data found for the target date ${formatDateFns(targetDate, 'dd-MM-yyyy')} in ${sourceUrl}.`;
      console.warn(reason);
      const mockResult = generateMockUvData(reason, false);
      return { 
          data: mockResult.data, 
          mockUvDataUsed: true, 
          message: mockResult.message, 
          error: mockResult.error 
      };
    }

    return { 
        data: processedData, 
        mockUvDataUsed: false, 
        message: `Successfully processed ${processedData.length} UV data points from RIVM for ${formatDateFns(targetDate, 'dd-MM-yyyy')}.` 
    };
} 