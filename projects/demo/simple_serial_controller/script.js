// --- DOM Elements ---
const refreshPortsButton = document.getElementById('refreshPortsButton');
const connectButton = document.getElementById('connectButton');
const sendButton = document.getElementById('sendButton');
const portSelector = document.getElementById('portSelector');
const baudRateSelector = document.getElementById('baudRate');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const gaugesContainer = document.getElementById('gauges-container');
const kpInput = document.getElementById('kp');
const kiInput = document.getElementById('ki');
const kdInput = document.getElementById('kd');
const ledIndicators = document.querySelectorAll('.led-indicator');
const darkModeToggle = document.getElementById('darkModeToggle');

// --- State Variables ---
let port;
let writer;
let reader;
let availablePorts = [];
let ledStates = Array(8).fill(false);

// --- Gauge Configuration ---
const gaugeConfigs = [
    { id: 'gauge-tilt', label: 'Tilt Angle (°)', min: -45, max: 45 }
];

// --- UI Update Functions ---
function updateStatus(text, connected = false) {
    statusText.textContent = text;
    if (connected) {
        statusIndicator.classList.remove('disconnected');
        statusIndicator.classList.add('connected');
    } else {
        statusIndicator.classList.remove('connected');
        statusIndicator.classList.add('disconnected');
    }
}

// --- Dark Mode Logic ---
darkModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
        darkModeToggle.textContent = '☀️';
    } else {
        localStorage.setItem('theme', 'light');
        darkModeToggle.textContent = '🌙';
    }
});

function applyTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = '☀️';
    } else {
        darkModeToggle.textContent = '🌙';
    }
}

// --- Gauge Creation and Update Logic ---
function createGauge(config) {
    const gaugeDiv = document.createElement('div');
    gaugeDiv.className = 'gauge';
    gaugeDiv.innerHTML = `
        <h3 class="gauge-title">${config.label}</h3>
        <svg viewBox="0 0 100 75" class="gauge-body">
            <path class="gauge-dial" d="M 10 70 A 40 40 0 1 1 90 70" stroke-width="8" fill="none"></path>
            <polygon class="gauge-needle" id="${config.id}-needle" points="50,15 48,70 52,70"></polygon>
            <circle cx="50" cy="70" r="4" fill="#333"></circle>
        </svg>
        <div class="gauge-value-display" id="${config.id}-text">0.0</div>
    `;
    gaugesContainer.appendChild(gaugeDiv);
}

function updateGauge(config, value) {
    const needle = document.getElementById(`${config.id}-needle`);
    const text = document.getElementById(`${config.id}-text`);
    const clampedValue = Math.max(config.min, Math.min(config.max, value));
    const range = config.max - config.min;
    const percentage = range === 0 ? 0 : (clampedValue - config.min) / range;
    const angle = -90 + (percentage * 180);
    if (needle && text) {
        needle.style.transform = `rotate(${angle}deg)`;
        text.textContent = clampedValue.toFixed(1);
    }
}

// Create the initial gauge(s)
gaugeConfigs.forEach(config => {
    createGauge(config);
    updateGauge(config, 0);
});

// --- LED Control Logic ---
ledIndicators.forEach(led => {
    led.addEventListener('click', () => {
        const index = parseInt(led.dataset.ledIndex, 10);
        ledStates[index] = !ledStates[index];
        led.classList.toggle('on', ledStates[index]);
    });
});

function resetLedControls() {
    ledStates.fill(false);
    ledIndicators.forEach(led => led.classList.remove('on'));
}

// --- Port Selection Logic ---
async function populatePortSelector() {
    try {
        availablePorts = await navigator.serial.getPorts();
    } catch (error) {
        updateStatus(`Error getting ports: ${error.message}`);
        return;
    }
    
    portSelector.innerHTML = '';
    if (availablePorts.length === 0) {
        portSelector.innerHTML = '<option value="">No ports found</option>';
        portSelector.disabled = true;
        connectButton.disabled = true;
    } else {
        availablePorts.forEach((port, index) => {
            const portInfo = port.getInfo();
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `Port ${index + 1} (VID: ${portInfo.usbVendorId || 'N/A'}, PID: ${portInfo.usbProductId || 'N/A'})`;
            portSelector.appendChild(option);
        });
        portSelector.disabled = false;
        connectButton.disabled = false;
        updateStatus('Status: Ports loaded. Select a port and connect.');
    }
}

refreshPortsButton.addEventListener('click', async () => {
    if (!('serial' in navigator)) {
        updateStatus('Error: Web Serial API not supported.');
        return;
    }
    updateStatus('Requesting port access...');
    try {
        await navigator.serial.requestPort();
        await populatePortSelector();
    } catch (error) {
        updateStatus(`User cancelled or error: ${error.message}`);
    }
});

// --- Connection Logic ---
connectButton.addEventListener('click', async () => {
    if (port && port.readable) {
        await disconnect();
    } else {
        await connect();
    }
});

async function connect() {
    const selectedPortIndex = portSelector.value;
    if (selectedPortIndex === "" || availablePorts.length === 0) {
        updateStatus("Error: No port selected.");
        return;
    }
    
    port = availablePorts[selectedPortIndex];
    
    try {
        const baudRate = parseInt(baudRateSelector.value, 10);
        await port.open({ baudRate });

        const textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        updateStatus(`Status: Connected (Baud: ${baudRate})`, true);
        connectButton.textContent = 'Disconnect';
        connectButton.classList.add('disconnect');
        portSelector.disabled = true;
        baudRateSelector.disabled = true;
        refreshPortsButton.disabled = true;

        listenForData();
        
    } catch (error) {
        updateStatus(`Error: ${error.message}`);
    }
}

async function disconnect() {
    if (reader) {
        await reader.cancel().catch(() => {});
        reader = null;
    }
    if (writer) {
        writer = null;
    }
    if (port) {
        await port.close().catch(() => {});
        port = null;
    }

    updateStatus('Status: Disconnected');
    connectButton.textContent = 'Connect';
    connectButton.classList.remove('disconnect');
    portSelector.disabled = false;
    baudRateSelector.disabled = false;
    refreshPortsButton.disabled = false;
    
    gaugeConfigs.forEach(config => updateGauge(config, 0));
    resetLedControls();
}

// --- Data Listening Logic ---
async function listenForData() {
    let partialData = '';
    try {
        while (port && port.readable) {
            const { value, done } = await reader.read();
            if (done) break;
            
            partialData += value;
            let newlineIndex;
            
            while ((newlineIndex = partialData.indexOf('\n')) !== -1) {
                const line = partialData.slice(0, newlineIndex).trim();
                partialData = partialData.slice(newlineIndex + 1);

                if (line) {
                    // Updated regex to only look for the angle value.
                    const regex = /A:\s*(-?[\d.]+)/;
                    const match = line.match(regex);

                    if (match) {
                        const tiltAngle = parseFloat(match[1]);
                        if (!isNaN(tiltAngle)) {
                            // Update the first (and only) gauge.
                            updateGauge(gaugeConfigs[0], tiltAngle);
                        }
                    }
                }
            }
        }
    } catch (error) {
        if (port) {
            updateStatus(`Read error: ${error.message}`);
            await disconnect();
        }
    }
}

// --- Data Sending Logic ---
sendButton.addEventListener('click', async () => {
    if (!port || !writer) {
        updateStatus('Error: Not connected.');
        return;
    }

    try {
        // PID and other float values
        const kp = parseFloat(kpInput.value);
        const ki = parseFloat(kiInput.value);
        const kd = parseFloat(kdInput.value);
        const tau = parseFloat(document.getElementById('tau').value);
        const setpoint = parseFloat(document.getElementById('setpoint').value);

        // LED bitmask
        let ledMask = 0;
        ledStates.forEach((state, index) => {
            if (state) {
                ledMask |= (1 << index);
            }
        });

        // Simplified data string
        const dataString = `p: ${kp} i: ${ki} d: ${kd} t: ${tau} s: ${setpoint} g: ${ledMask}\n`;

        await writer.write(dataString);

        updateStatus('Data sent successfully.', true);
        console.log('Sent:', dataString);

    } catch (error) {
        updateStatus(`Send error: ${error.message}`, true);
    }
});

// --- Initial Page Load State ---
window.addEventListener('load', () => {
    applyTheme(); // Apply saved theme on load
    if (!('serial' in navigator)) {
        updateStatus('Error: Web Serial API is not supported by this browser.');
        refreshPortsButton.disabled = true;
    } else {
        updateStatus('Status: Disconnected. Request port access to begin.');
    }
});
