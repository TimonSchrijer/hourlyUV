import { HourlyUvData as ApiHourlyUvData } from "@/app/api/uv-data/route";

export interface Station {
  StationID: string;
  "LON(deg)": string; //Longitude
  "LAT(deg)": string; //Latitude
  Location: string; // Name of the location
  "Height(mNAP)": string;
}

// Interface for UV data once it's been processed with coordinates
export interface UvDataPoint extends ApiHourlyUvData {
  latitude: number;
  longitude: number;
  name: string; // Station name
}

// You can re-export types from API routes if they are used on the client
export type HourlyUvData = ApiHourlyUvData; 