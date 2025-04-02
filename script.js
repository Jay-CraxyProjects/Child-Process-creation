document.addEventListener('DOMContentLoaded', () => {
    const codeInput = document.getElementById('codeInput');
    const startButton = document.getElementById('startButton');
    const resetButton = document.getElementById('resetButton');
    const codeOutput = document.getElementById('codeOutput');
    const treeContainer = document.getElementById('treeContainer');
    const simOutput = document.getElementById('simOutput');
    const statusElem = document.getElementById('status');

    // --- Optional: Initialize CodeMirror ---
    const editor = CodeMirror.fromTextArea(codeInput, {
        lineNumbers: true,
        mode: "text/x-csrc", // C mode
        theme: "material-darker", // Example theme
        matchBrackets: true,
        autoCloseBrackets: true,
        lineWrapping: true, // Wrap long lines
    });
    editor.setSize("100%", 300); // Adjust size as needed
    // --- End CodeMirror ---


    let simulationInterval = null;
    let processes = []; // Array to hold simulated process states
    let nextPid = 1; // Simple PID counter
    let codeLines = []; // Store code lines for easy access
    let simulationRunning = false;
    const DELAY = 1000; // 1 second delay

    // --- Process State Object ---
    class Process {
        constructor(pid, ppid, startLine, parentVars = {}) {
            this.pid = pid;
            this.ppid = ppid;
            this.pc = startLine; // Program Counter (current line index)
            this.status = 'running'; // 'running', 'finished'
            this.variables = JSON.parse(JSON.stringify(parentVars)); // Deep copy variables
            this.isNewFork = false; // Flag to handle the line *after* fork
            this.forkReturnValue = null; // To simulate fork() return value
        }
    }

    // --- Initialization and Reset ---
    function initializeSimulation() {
        resetSimulation(); // Clear previous state
        // codeLines = codeInput.value.split('\n'); // Use this if not using CodeMirror
        codeLines = editor.getValue().split('\n'); // Get code from CodeMirror

        displayCodeWithLines();

        // Create the initial process
        const initialProcess = new Process(nextPid++, 0, 0); // PID 1, PPID 0, start at line 0
        processes.push(initialProcess);

        updateProcessTree();
        statusElem.textContent = 'Ready';
        simOutput.textContent = ''; // Clear previous output
    }

    function resetSimulation() {
        clearInterval(simulationInterval);
        simulationInterval = null;
        processes = [];
        nextPid = 1;
        codeLines = [];
        codeOutput.innerHTML = '';
        treeContainer.innerHTML = ''; // Clear tree vis
        simOutput.textContent = '';
        simulationRunning = false;
        statusElem.textContent = 'Idle';
        startButton.disabled = false;
    }

    // --- Display Code ---
    function displayCodeWithLines() {
        codeOutput.innerHTML = ''; // Clear previous
        codeLines.forEach((line, index) => {
            const lineSpan = document.createElement('span');
            lineSpan.classList.add('line');
            lineSpan.id = `line-${index}`;
            lineSpan.textContent = line;
            codeOutput.appendChild(lineSpan);
        });
    }

    // --- Simulation Loop ---
    function startSimulation() {
        if (simulationRunning || processes.length === 0) return;
        simulationRunning = true;
        startButton.disabled = true;
        statusElem.textContent = 'Running...';

        simulationInterval = setInterval(simulationStep, DELAY);
    }

    function simulationStep() {
        let activeProcesses = processes.filter(p => p.status === 'running');
        if (activeProcesses.length === 0) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            simulationRunning = false;
            statusElem.textContent = 'Finished';
            startButton.disabled = false; // Re-enable start if needed, or keep disabled
            clearHighlights(); // Clear last highlight
            updateProcessTree(); // Update tree for final finished states
            return;
        }

        clearHighlights();
        let processesAdvanced = 0;

        // Create a copy to iterate over, as 'processes' array might be modified by fork
        const currentTickProcesses = [...processes];

        currentTickProcesses.forEach(proc => {
            if (proc.status !== 'running') return;

            highlightLine(proc.pc, proc.pid); // Highlight current line for this process

            if (proc.pc >= codeLines.length) {
                proc.status = 'finished';
                addSimOutput(`Process ${proc.pid} finished (reached end of code).`);
                 updateProcessTree(); // Update tree when process finishes
                return; // Finished execution
            }

            const line = codeLines[proc.pc].trim();

            // --- Simple Parser/Interpreter ---
            let advancePC = true; // Whether to move to the next line automatically

            if (line.includes('fork()')) {
                // *** FORK Simulation ***
                const childPid = nextPid++;
                // Child starts execution AFTER the fork line
                const child = new Process(childPid, proc.pid, proc.pc + 1, proc.variables);
                child.isNewFork = true; // Mark as just forked
                child.forkReturnValue = 0; // Child gets 0

                // Parent continues from the next line too, but gets child's PID
                proc.forkReturnValue = childPid;

                processes.push(child);
                addSimOutput(`Process ${proc.pid} called fork(). Created child Process ${childPid}.`);
                updateProcessTree(); // Update tree visualization

            } else if (line.startsWith('printf')) {
                // Simulate printf - very basic
                const output = evaluatePrintf(line, proc);
                addSimOutput(`[PID:${proc.pid}] ${output}`);

            } else if (line.includes('return') || line.startsWith('}')) {
                 // Simple heuristic: treat return or closing brace as exit for now
                 if (isEndOfScope(proc.pc)) { // More complex logic needed here potentially
                     proc.status = 'finished';
                     addSimOutput(`Process ${proc.pid} finished (return/exit scope).`);
                     updateProcessTree();
                     advancePC = false; // Don't advance PC after finishing
                 }
             }
             // Add more handlers here (if/else, simple assignments, getpid/getppid simulation)
              else if (line.includes('getpid()')) {
                // No actual variable assignment simulation here yet, just acknowledging
                // In a real sim, you'd parse assignments like `pid_t mypid = getpid();`
                // and store 'mypid' in proc.variables
             }
             else if (line.includes('getppid()')) {
                 // Similar to getpid()
             }


            // Advance Program Counter for the next step
            if (advancePC && proc.status === 'running') {
                 proc.pc++;
            }

            processesAdvanced++;
        });

        if(processesAdvanced === 0 && activeProcesses.length > 0){
            // Edge case: all processes might be waiting or finished in this tick but loop didn't terminate
            // This check prevents infinite loops if logic is stuck
             let stillRunning = processes.some(p => p.status === 'running');
             if (!stillRunning) {
                 clearInterval(simulationInterval);
                 simulationInterval = null;
                 simulationRunning = false;
                 statusElem.textContent = 'Finished (All Processes Done)';
                 startButton.disabled = false;
                  clearHighlights();
                  updateProcessTree();
             }
        }

    }

    // --- Basic Printf Simulation ---
    function evaluatePrintf(line, proc) {
        // Very basic: extract string literal and replace placeholders
        try {
            const match = line.match(/printf\("([^"]*)"/);
            let formatString = match ? match[1] : '...';

            // Simulate placeholders (very simplified)
            formatString = formatString.replace(/%d/g, (match) => {
                 if (line.includes('getpid()')) return proc.pid;
                 if (line.includes('getppid()')) return proc.ppid;
                 if (line.includes('child_pid') && proc.forkReturnValue !== null) return proc.forkReturnValue; // Simulate last fork result
                 return '?'; // Placeholder for other %d
            });
            formatString = formatString.replace(/\\n/g, '\n'); // Handle newline characters
            return formatString.trim();
        } catch (e) {
            return "Error parsing printf";
        }
    }

     // Placeholder for more complex scope checking if needed
     function isEndOfScope(lineNumber) {
         // Basic check: is the next line empty or non-existent?
         // Or does the current line contain 'return' or '}' at base indentation?
         // This needs to be much smarter for real C block handling.
         const line = codeLines[lineNumber].trim();
         if (line.startsWith('return') || line === '}') {
             // Simplistic check - assumes '}' ends the main function or relevant block
             // A proper parser would track block depth.
             return true;
          }
         return lineNumber >= codeLines.length - 1;
     }


    // --- UI Updates ---
    function clearHighlights() {
        document.querySelectorAll('.highlight').forEach(el => {
            el.classList.remove('highlight');
            el.style.backgroundColor = ''; // Reset specific styles if needed
            el.style.borderLeft = '';
         });
    }

    function highlightLine(lineIndex, pid) {
         const lineEl = document.getElementById(`line-${lineIndex}`);
         if (lineEl) {
             lineEl.classList.add('highlight');
             // Optional: Color code by PID (more complex)
             // Use pid to select a color, e.g., using HSL rotation
             const hue = (pid * 40) % 360; // Simple color variation
             lineEl.style.backgroundColor = `hsla(${hue}, 100%, 85%, 0.7)`;
             lineEl.style.borderLeft = `3px solid hsla(${hue}, 100%, 50%, 1)`;
         }
     }


    function addSimOutput(message) {
        simOutput.textContent += message + '\n';
        simOutput.scrollTop = simOutput.scrollHeight; // Auto-scroll
    }

    // --- Process Tree Visualization (Using D3.js - Example) ---
    function updateProcessTree() {
        treeContainer.innerHTML = ''; // Clear previous tree

        if (processes.length === 0) return;

        // 1. Prepare data in a hierarchical format D3 understands
        // (e.g., { name: "PID 1", children: [ { name: "PID 2", children: [...] } ] })
        const treeData = buildHierarchy(processes);

        if (!treeData) return; // No root process found (shouldn't happen after init)

        // 2. Use D3's tree layout
        const width = treeContainer.clientWidth;
         // Adjust height dynamically or set fixed
        const margin = { top: 20, right: 10, bottom: 20, left: 30 };
        // Heuristic for height based on process count / depth needed
        const estimatedHeight = processes.length * 50 + margin.top + margin.bottom;


        const svg = d3.select(treeContainer).append("svg")
            .attr("width", width)
            .attr("height", estimatedHeight) // Adjust height as needed
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const root = d3.hierarchy(treeData);
        const treeLayout = d3.tree().size([estimatedHeight - margin.top - margin.bottom, width - margin.left - margin.right - 100]); // Adjust horizontal spacing
        treeLayout(root);

        // Links (lines)
        svg.selectAll('path.link')
            .data(root.links())
            .enter().append('path')
            .attr('class', 'link')
            .attr('d', d3.linkHorizontal()
                .x(d => d.y) // Switch x and y for horizontal tree
                .y(d => d.x))
            .style('fill', 'none')
            .style('stroke', '#ccc')
            .style('stroke-width', '1.5px');

        // Nodes
        const node = svg.selectAll('g.node')
            .data(root.descendants())
            .enter().append('g')
            .attr('class', 'node')
            .attr('transform', d => `translate(${d.y},${d.x})`); // Switch x and y

        node.append('circle')
            .attr('r', 10)
            .style('fill', d => d.data.status === 'finished' ? '#ccc' : '#69b3a2') // Color based on status
             .style('stroke', 'black')
             .style('stroke-width', '1px');

        node.append('text')
            .attr('dy', '.35em')
            .attr('x', d => d.children ? -15 : 15) // Position text left/right of circle
            .style('text-anchor', d => d.children ? 'end' : 'start')
            .text(d => d.data.name)
            .style('font-size', '12px');
    }

    function buildHierarchy(processList) {
         if (processList.length === 0) return null;

         const processMap = new Map();
         processList.forEach(p => {
             processMap.set(p.pid, {
                 name: `PID ${p.pid}`,
                 pid: p.pid,
                 ppid: p.ppid,
                 status: p.status,
                 children: []
             });
         });

         let rootNode = null;
         processMap.forEach(node => {
             if (node.ppid === 0) {
                 rootNode = node; // Found the root (initial process)
             } else {
                 const parent = processMap.get(node.ppid);
                 if (parent) {
                     parent.children.push(node);
                 } else {
                     console.warn(`Parent PID ${node.ppid} not found for PID ${node.pid}`);
                     // Could potentially happen if parent finished before child was processed fully
                     // Or handle this case by attaching to a placeholder if needed
                 }
             }
         });

        // Ensure there's a root, even if it's just the first process if ppid 0 logic fails
        if (!rootNode && processList.length > 0) {
             const firstProcess = processMap.get(processList[0].pid);
             if(firstProcess && !processList.some(p => p.pid === firstProcess.ppid)) {
                rootNode = firstProcess;
             }
        }

         return rootNode;
     }


    // --- Event Listeners ---
    startButton.addEventListener('click', () => {
         initializeSimulation(); // Prepare based on current code
         startSimulation();
     });

    resetButton.addEventListener('click', resetSimulation);

    // Initialize on load
    initializeSimulation(); // Display initial code etc.

});