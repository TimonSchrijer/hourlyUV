'use client';

import React from 'react';

interface TimeSliderProps {
  availableHours: string[]; // Sorted array of ISO hour strings
  selectedHour: string | null;
  onHourChange: (hourISO: string) => void;
}

const TimeSlider: React.FC<TimeSliderProps> = ({ availableHours, selectedHour, onHourChange }) => {
  if (!availableHours || availableHours.length === 0) {
    return null; // Don't render if no hours are available
  }

  const selectedIndex = selectedHour ? availableHours.indexOf(selectedHour) : -1;

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newIndex = parseInt(event.target.value, 10);
    if (availableHours[newIndex]) {
      onHourChange(availableHours[newIndex]);
    }
  };

  const formatHourDisplay = (isoHour: string | null) => {
    if (!isoHour) return "N/A";
    return new Date(isoHour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="mt-2 w-full">
      <label htmlFor="time-slider-input" className="mr-2 text-sm">
        Time: <span className="font-semibold">{formatHourDisplay(selectedHour)}</span>
      </label>
      <input
        id="time-slider-input"
        type="range"
        min="0"
        max={availableHours.length - 1}
        value={selectedIndex === -1 ? '0' : selectedIndex}
        onChange={handleSliderChange}
        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
        disabled={availableHours.length <= 1}
      />
      {availableHours.length > 1 && (
        <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
          <span>{formatHourDisplay(availableHours[0])}</span>
          <span>{formatHourDisplay(availableHours[availableHours.length - 1])}</span>
        </div>
      )}
    </div>
  );
};

export default TimeSlider; 