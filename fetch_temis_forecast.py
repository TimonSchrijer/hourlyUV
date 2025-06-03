import requests
import netCDF4
import numpy as np
from datetime import datetime, timedelta
import os

# --- Configuration ---
NETCDF_URL = "https://d1qb6yzwaaq4he.cloudfront.net/uvradiation/UVI/uvief_fc.nc"
LOCAL_NETCDF_FILENAME = "uvief_fc_latest.nc"

# UPDATE THIS TO YOUR ACTUAL RIVM DATA FILE PATH
# If you don't have an existing file, or want to start fresh, set to None or an empty string
EXISTING_DATA_FILENAME = "temis_uv_forecast.txt" # <<<< USER: PLEASE VERIFY/UPDATE THIS FILENAME

# The script will now try to merge with EXISTING_DATA_FILENAME 
# and save the combined result to this OUTPUT_FILENAME.
# If EXISTING_DATA_FILENAME is not found, it will just save the new forecast here.
OUTPUT_FILENAME = "merged_uv_data.txt"

# Coordinates for De Bilt (approximated)
TARGET_LAT = 52.1
TARGET_LON = 5.18

# RIVM Historical Data Configuration
RIVM_HISTORICAL_BASE_URL = "https://data.rivm.nl/data/zonkracht/"
# Add years you want to fetch historical data for.
# Ensure these files (e.g., ZonkrachtRIVM2023.txt) exist on the server.
HISTORICAL_YEARS_TO_FETCH = [2023, 2024] 
RIVM_HISTORICAL_INST_CODE = "RIVM_PEAK" # Changed from RIVM_NOON

# Header for the output file (make sure it matches your app.js parser)
FILE_HEADER_LINES = [
    "# UV Index Data (TEMIS forecast & RIVM historical)",
    "# Data processed for De Bilt coordinates",
    "# Format: YYYYMMDD hhmm  T.dec   UVI InstCode",
    "# T.dec is a placeholder (0.0 for forecast), InstCode indicates source.",
    "YYYYMMDD hhmm  T.dec   UVI InstCode"
]

# --- Functions ---

def download_netcdf_file(url, local_filename):
    """Downloads the netCDF file from the given URL."""
    print(f"Downloading {url} to {local_filename}...")
    try:
        response = requests.get(url, timeout=60) # Increased timeout
        response.raise_for_status()  # Raise an exception for bad status codes
        with open(local_filename, 'wb') as f:
            f.write(response.content)
        print("Download complete.")
        try:
            file_size = os.path.getsize(local_filename)
            print(f"Downloaded file size: {file_size} bytes")
            if file_size < 1024: # Arbitrary small size check, e.g. < 1KB
                print("Warning: Downloaded file is very small, may be empty or corrupted.")
        except OSError as e:
            print(f"Could not get file size: {e}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading file: {e}")
        return False

def find_nearest_grid_point(lats_data, lons_data, target_lat, target_lon):
    """Finds the index of the nearest grid point to the target lat/lon."""
    if lats_data.ndim == 1 and lons_data.ndim == 1:
        lon_grid, lat_grid = np.meshgrid(lons_data, lats_data)
    elif lats_data.ndim == 2 and lons_data.ndim == 2: # Already a grid
        lat_grid = lats_data
        lon_grid = lons_data
    else:
        raise ValueError("Latitude and Longitude arrays have unexpected dimensions.")

    distance_sq = (lat_grid - target_lat)**2 + (lon_grid - target_lon)**2
    lat_idx, lon_idx = np.unravel_index(np.argmin(distance_sq, axis=None), distance_sq.shape)
    
    print(f"Target Lat/Lon: ({target_lat}, {target_lon})")
    print(f"Found nearest grid point at index: (lat_idx={lat_idx}, lon_idx={lon_idx})")
    print(f"Grid Lat/Lon: ({lat_grid[lat_idx, lon_idx]}, {lon_grid[lat_idx, lon_idx]})")
    return lat_idx, lon_idx

def process_netcdf_data(local_filename, target_lat, target_lon):
    """Processes the netCDF file to extract UV forecast data for the target location."""
    print(f"Processing {local_filename}...")
    extracted_data = []
    try:
        if not os.path.exists(local_filename) or os.path.getsize(local_filename) == 0:
            print(f"Error: File {local_filename} does not exist or is empty. Aborting processing.")
            return None

        with netCDF4.Dataset(local_filename, 'r') as nc_file:
            if not nc_file:
                print("Error: Could not open NetCDF dataset properly (nc_file object is invalid).")
                return None
            
            if 'PRODUCT' not in nc_file.groups:
                print("Error: 'PRODUCT' group not found in NetCDF file.")
                print(f"Available groups: {nc_file.groups.keys()}")
                return None
            
            product_group = nc_file.groups['PRODUCT']
            # print(f"Processing data from group: PRODUCT")
            # print(f"Variables in PRODUCT group: {product_group.variables.keys()}")

            lat_var_name = 'latitude'
            lon_var_name = 'longitude'
            uv_index_var_name = 'uvi_clear' 
            date_values_var_name = 'date' 

            required_vars = [lat_var_name, lon_var_name, uv_index_var_name, date_values_var_name]
            for rv in required_vars:
                if rv not in product_group.variables:
                    print(f"Error: Required variable '{rv}' not found in PRODUCT group. Available: {product_group.variables.keys()}")
                    return None

            lats = product_group.variables[lat_var_name][:]
            lons = product_group.variables[lon_var_name][:]
            uv_data = product_group.variables[uv_index_var_name]
            date_values = product_group.variables[date_values_var_name][:]
            num_time_steps = len(date_values)

            # === Investigation START ===
            # print(f"Shape of 'date' variable ({date_values_var_name}): {product_group.variables[date_values_var_name].shape}")
            # print(f"Content of 'date' variable (first 5): {date_values[:5]}")
            # print(f"Shape of UV index variable ('{uv_index_var_name}'): {uv_data.shape}")
            # 
            # # Check for other potential time coordinate variables
            # print("Available variables in PRODUCT group:", list(product_group.variables.keys()))
            # if 'time' in product_group.variables:
            #     time_var = product_group.variables['time']
            #     print(f"Shape of 'time' variable: {time_var.shape}")
            #     print(f"Units of 'time' variable: {time_var.units if hasattr(time_var, 'units') else 'N/A'}")
            #     print(f"Content of 'time' variable (first 5): {time_var[:5]}")
            # if 'forecast_hour' in product_group.variables:
            #     fc_hour_var = product_group.variables['forecast_hour']
            #     print(f"Shape of 'forecast_hour' variable: {fc_hour_var.shape}")
            #     print(f"Content of 'forecast_hour' variable (first 5): {fc_hour_var[:5]}")
            # === Investigation END ===

            lat_idx, lon_idx = find_nearest_grid_point(lats, lons, target_lat, target_lon)
            
            # print(f"Number of forecast days found: {num_time_steps}")

            for i in range(num_time_steps):
                date_int = date_values[i]
                year = date_int // 10000
                month = (date_int % 10000) // 100
                day = date_int % 100
                current_datetime_utc = datetime(year, month, day, 12, 0, 0) 
                
                if uv_data.ndim == 3: 
                     uvi_val = uv_data[i, lat_idx, lon_idx]
                elif uv_data.ndim == 4 and uv_data.shape[0] == num_time_steps :
                    uvi_val = uv_data[i, 0, lat_idx, lon_idx]
                else:
                    print(f"Error: UV data in PRODUCT group has unexpected dimensions: {uv_data.ndim}, shape: {uv_data.shape}")
                    return None

                if hasattr(uvi_val, 'mask') and uvi_val.mask or uvi_val is np.ma.masked or np.isnan(uvi_val) or not np.isfinite(uvi_val):
                    continue

                extracted_data.append({
                    "date_obj": current_datetime_utc, # Store as datetime object for sorting
                    "date_str": current_datetime_utc.strftime("%Y%m%d"),
                    "time_str": current_datetime_utc.strftime("%H%M"),
                    "t_dec": "0.0", # Placeholder for forecast
                    "uvi_str": f"{float(uvi_val):.2f}",
                    "inst_code": "TEMIS_FCST"
                })
        
        print(f"Successfully extracted {len(extracted_data)} new daily forecast data points.")
        return extracted_data

    except FileNotFoundError:
        print(f"Error: File {local_filename} not found.")
        return None
    except Exception as e:
        print(f"Error processing netCDF file: {e}")
        import traceback
        traceback.print_exc()
        return None

def download_text_file(url, local_filename):
    """Downloads a text file from the given URL."""
    print(f"Downloading {url} to {local_filename}...")
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        with open(local_filename, 'w', encoding='utf-8') as f: # Write as text
            f.write(response.text)
        print("Download complete.")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading text file {url}: {e}")
        return False

def fetch_and_process_rivm_historical_year(year):
    """
    Downloads, parses, and extracts the daily peak UV data for a given year from RIVM.
    Returns a list of daily peak data records.
    """
    historical_peak_records = []
    filename = f"ZonkrachtRIVM{year}.txt"
    url = f"{RIVM_HISTORICAL_BASE_URL}{filename}"
    local_copy_filename = f"temp_rivm_{filename}"

    print(f"\nFetching RIVM historical data for {year} from {url}...")
    if not download_text_file(url, local_copy_filename):
        print(f"Failed to download RIVM data for {year}. Skipping.")
        return historical_peak_records

    # Store all records for the year, grouped by day_key (YYYYMMDD)
    all_daily_entries = {}

    print(f"Processing RIVM historical data file: {local_copy_filename}")
    try:
        with open(local_copy_filename, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or line.lower().startswith('yyyymmdd'):
                    continue 
                
                parsed_record = parse_existing_data_line(line)
                if parsed_record:
                    day_key = parsed_record['date_str']
                    if day_key not in all_daily_entries:
                        all_daily_entries[day_key] = []
                    all_daily_entries[day_key].append(parsed_record)
        
        # For each day, find the entry with the maximum UVI
        for day_key, hourly_entries_for_day in all_daily_entries.items():
            if not hourly_entries_for_day:
                continue

            # Find the record with the maximum UVI for the current day
            # We need to handle uvi_str being a string, convert to float for comparison
            try:
                peak_record_for_day = max(hourly_entries_for_day, key=lambda r: float(r['uvi_str']))
            except ValueError as ve:
                print(f"Warning: Could not determine peak UVI for {day_key} due to invalid UVI value in entries: {ve}. Skipping day.")
                continue
            
            if peak_record_for_day:
                # Create the entry to be stored
                historical_peak_entry = {
                    "date_obj": peak_record_for_day['date_obj'],
                    "date_str": peak_record_for_day['date_str'],
                    "time_str": peak_record_for_day['time_str'], # This is the actual time of the peak
                    "t_dec": peak_record_for_day['t_dec'],
                    "uvi_str": peak_record_for_day['uvi_str'],
                    "inst_code": RIVM_HISTORICAL_INST_CODE 
                }
                historical_peak_records.append(historical_peak_entry)

    except Exception as e:
        print(f"Error processing RIVM file {local_copy_filename}: {e}")
    finally:
        if os.path.exists(local_copy_filename):
            try:
                os.remove(local_copy_filename) 
            except OSError as e:
                print(f"Warning: Could not remove temporary file {local_copy_filename}: {e}")
                
    print(f"Found {len(historical_peak_records)} daily peak data points for RIVM {year}.")
    return historical_peak_records

def parse_existing_data_line(line):
    """Parses a single line from the existing data file."""
    parts = line.strip().split()
    if len(parts) >= 4: # Allow for optional InstCode if not present in all RIVM files
        yyyy_mm_dd = parts[0]
        hh_mm = parts[1]
        t_dec_str = parts[2]
        uvi_str = parts[3]
        # Handle cases where InstCode might be missing in some historical file lines
        inst_code_str = parts[4] if len(parts) >= 5 else "RIVM_HIST" # Default if not present
        
        try:
            year = int(yyyy_mm_dd[0:4])
            month = int(yyyy_mm_dd[4:6])
            day = int(yyyy_mm_dd[6:8])
            hour = int(hh_mm[0:2])
            minute = int(hh_mm[2:4])
            date_obj = datetime(year, month, day, hour, minute)
            # Validate UVI and T.dec
            float(uvi_str) 
            float(t_dec_str)

            return {
                "date_obj": date_obj,
                "date_str": yyyy_mm_dd,
                "time_str": hh_mm,
                "t_dec": t_dec_str,
                "uvi_str": uvi_str,
                "inst_code": inst_code_str
            }
        except ValueError as e:
            # print(f"Skipping malformed line in existing data: {line.strip()} - {e}")
            return None
    return None

def format_and_save_data(data_to_add, existing_data_filepath, output_filepath):
    """Merges new data with existing data, sorts, ensures uniqueness, and saves."""
    all_data_records = []
    processed_keys = set() # To ensure unique entries based on YYYYMMDDHHMM+InstCode

    # 1. Load existing data if file exists
    if existing_data_filepath and os.path.exists(existing_data_filepath):
        print(f"Loading existing data from {existing_data_filepath}...")
        with open(existing_data_filepath, 'r') as f_existing:
            for line in f_existing:
                line = line.strip()
                if not line or line.startswith('#') or line.lower().startswith('yyyymmdd'):
                    continue # Skip comments, header, or empty lines
                parsed_record = parse_existing_data_line(line)
                if parsed_record:
                    # Create a unique key for this record
                    record_key = f"{parsed_record['date_str']}{parsed_record['time_str']}{parsed_record['inst_code']}"
                    if record_key not in processed_keys:
                        all_data_records.append(parsed_record)
                        processed_keys.add(record_key)
        print(f"Loaded {len(all_data_records)} unique records from existing file: {existing_data_filepath}")
    else:
        if existing_data_filepath:
             print(f"Warning: Existing data file '{existing_data_filepath}' not found. Starting fresh or only with new data.")

    # 2. Add new forecast data (if any)
    if data_to_add:
        print(f"Adding {len(data_to_add)} new/fetched records...")
        for record in data_to_add:
            # Create a unique key for this new forecast record
            record_key = f"{record['date_str']}{record['time_str']}{record['inst_code']}"
            if record_key not in processed_keys:
                all_data_records.append(record)
                processed_keys.add(record_key)
            else:
                print(f"Skipping duplicate data point (already processed or from existing file): {record_key}")

    if not all_data_records:
        print("No data (neither existing nor new/fetched) to format and save.")
        return

    # 3. Sort all data by datetime object
    all_data_records.sort(key=lambda r: r['date_obj'])
    print(f"Total unique records after merge: {len(all_data_records)}")

    # 4. Write to output file
    print(f"Saving merged and sorted data to {output_filepath}...")
    try:
        with open(output_filepath, 'w') as f_out:
            for header_line in FILE_HEADER_LINES:
                f_out.write(header_line + "\n")
            
            for record in all_data_records:
                line_out = f"{record['date_str']} {record['time_str']}  {record['t_dec']}   {record['uvi_str']} {record['inst_code']}"
                f_out.write(line_out + "\n")
        print(f"Data successfully saved to {output_filepath}")
    except IOError as e:
        print(f"Error writing to file {output_filepath}: {e}")

# --- Main Execution ---
if __name__ == "__main__":
    print("Starting TEMIS UV Forecast Fetcher & Data Merger...")
    
    all_data_to_process = []

    # 1. Download and process new TEMIS forecast data
    if download_netcdf_file(NETCDF_URL, LOCAL_NETCDF_FILENAME):
        new_temis_forecasts = process_netcdf_data(LOCAL_NETCDF_FILENAME, TARGET_LAT, TARGET_LON)
        if new_temis_forecasts: # Ensure it's not None
            all_data_to_process.extend(new_temis_forecasts)
        else:
            print("Processing TEMIS netCDF data failed or returned no data.")
        # Clean up downloaded netCDF file immediately after processing
        if os.path.exists(LOCAL_NETCDF_FILENAME):
            try:
                os.remove(LOCAL_NETCDF_FILENAME)
                print(f"Cleaned up {LOCAL_NETCDF_FILENAME}.")
            except OSError as e:
                print(f"Warning: Could not remove downloaded netCDF file {LOCAL_NETCDF_FILENAME}: {e}")
    else:
        print("Could not download TEMIS forecast data. Proceeding without new TEMIS data.")

    # 2. Fetch and process RIVM historical data
    print("\nFetching RIVM historical data...")
    for year in HISTORICAL_YEARS_TO_FETCH:
        rivm_year_data = fetch_and_process_rivm_historical_year(year)
        if rivm_year_data: # Only extend if data was successfully fetched and processed
            all_data_to_process.extend(rivm_year_data)
    
    # 3. Format, merge with existing, and save all collected data
    if not all_data_to_process and not (EXISTING_DATA_FILENAME and os.path.exists(EXISTING_DATA_FILENAME)):
        print("\nNo new TEMIS data, no RIVM historical data, and no existing data file to process. Exiting.")
    else:
        print(f"\nProceeding to format and save. Total new/fetched records: {len(all_data_to_process)}")
        format_and_save_data(all_data_to_process, EXISTING_DATA_FILENAME, OUTPUT_FILENAME)
    
    print("\nScript finished.") 