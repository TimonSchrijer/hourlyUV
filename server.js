const express = require('express');
const fs = require('fs'); // For file system operations
const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path'); // For constructing file paths

const app = express();
const PORT = process.env.PORT || 3000;

const LOCAL_UV_DATA_FILE = path.join(__dirname, 'merged_uv_data.txt');

// Serve static files from the current directory (where index.html, style.css, app.js are)
app.use(express.static(__dirname));

app.get('/api/uvdata', async (req, res) => {
    console.log(`Serving UV data from local file: ${LOCAL_UV_DATA_FILE}`);
    try {
        // Check if the file exists
        if (!fs.existsSync(LOCAL_UV_DATA_FILE)) {
            console.error(`Local UV data file not found: ${LOCAL_UV_DATA_FILE}`);
            return res.status(404).send('UV data file not found on server.');
        }

        // Read the file content
        const textData = fs.readFileSync(LOCAL_UV_DATA_FILE, 'utf8');
        
        res.type('text/plain'); // Send as plain text
        res.send(textData);

    } catch (error) {
        console.error("Error in /api/uvdata route while serving local file:", error.message);
        res.status(500).send(`Failed to serve UV data from local file. Server error: ${error.message}`);
    }
});

// Schedule the Python script to run every day at 3:00 AM
cron.schedule('0 3 * * *', () => {
  const scriptPath = path.join(__dirname, 'fetch_temis_forecast.py');
  exec(`python3 "${scriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error running fetch_temis_forecast.py: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`fetch_temis_forecast.py stderr: ${stderr}`);
    }
    console.log(`fetch_temis_forecast.py output: ${stdout}`);
  });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Serving static files from: ${__dirname}`);
    console.log(`UV data will be served from local file via: http://localhost:${PORT}/api/uvdata`);
}); 