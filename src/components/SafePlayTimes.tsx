'use client';

import React from 'react';
import { UvDataPoint } from '@/types';
import { getUVRisk } from '@/utils/uvUtils';

interface SafePlayTimesProps {
  uvDataForDay: UvDataPoint[]; // All UV data points for the current day/dataset
  // We might need to consider data across multiple locations or a specific location.
  // For now, let's assume we want to find generally safe hours based on an average or specific station.
  // Or, it could show safe hours for *each* station if multiple are present.
  // Let's start by finding hours where *all* currently displayed stations (for the selected hour) are < 4
  // A better approach might be to analyze *allUvData* across all its hours and locations.
}

const SafePlayTimes: React.FC<SafePlayTimesProps> = ({ uvDataForDay }) => {
  if (!uvDataForDay || uvDataForDay.length === 0) {
    return <p className="text-sm">Safe play times data unavailable.</p>;
  }

  // Group data by hour first
  const hourlyData: Record<string, UvDataPoint[]> = {};
  uvDataForDay.forEach(dp => {
    if (!hourlyData[dp.hour]) {
      hourlyData[dp.hour] = [];
    }
    hourlyData[dp.hour].push(dp);
  });

  const safeHours: string[] = [];
  const moderateHours: string[] = [];

  Object.entries(hourlyData).forEach(([hourISO, dataPoints]) => {
    // Check if ALL data points for this hour have UV index < 4
    const allSafe = dataPoints.every(dp => dp.uvIndex < 4);
    // Alternative: check if AVERAGE UV index is < 4
    // const averageUv = dataPoints.reduce((sum, dp) => sum + dp.uvIndex, 0) / dataPoints.length;
    // if (averageUv < 4) {
    //   safeHours.push(hourISO);
    // }

    if (allSafe) {
      safeHours.push(hourISO);
    }
    // Let's also find moderate hours (UV < 6) for additional context
    const allModerateOrLower = dataPoints.every(dp => dp.uvIndex < 6);
    if(!allSafe && allModerateOrLower) {
        moderateHours.push(hourISO);
    }

  });

  safeHours.sort();
  moderateHours.sort();

  const formatHour = (isoHour: string) => new Date(isoHour).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });

  return (
    <div className="p-2 bg-white bg-opacity-90 rounded shadow-md text-xs mt-2">
      <h3 className="font-bold text-sm mb-1 text-gray-700">Safe Outdoor Play Times (UV &lt; 4)</h3>
      {safeHours.length > 0 ? (
        <ul className="list-disc list-inside text-green-700">
          {safeHours.map(hour => <li key={hour}>{formatHour(hour)}</li>)}
        </ul>
      ) : (
        <p className="text-gray-600">No hours found with UV index consistently below 4.</p>
      )}
      {moderateHours.length > 0 && (
        <>
            <h3 className="font-bold text-sm mb-1 mt-2 text-gray-700">Moderate UV Times (UV 4-5)</h3>
            <ul className="list-disc list-inside text-yellow-700">
                {moderateHours.map(hour => <li key={hour}>{formatHour(hour)}</li>)}
            </ul>
        </>
      )}
      <p className="text-xs text-gray-500 mt-1">Based on current data. Always check specific location.</p>
    </div>
  );
};

export default SafePlayTimes; 