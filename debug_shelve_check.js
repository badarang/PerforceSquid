const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(command) {
    return new Promise((resolve, reject) => {
        exec('p4 ' + command, (err, stdout, stderr) => {
            if (err && !stdout) { // p4 sometimes returns exit code 1 for warnings
                console.error(`Error running ${command}:`, stderr || err.message);
                // reject(err); 
                // Don't reject, just return stdout/stderr to analyze
                resolve(stdout + '\n' + stderr);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function debugShelve() {
    try {
        console.log('--- Starting Debug ---');
        
        // 1. Create a test file
        const testFile = 'test_shelve_' + Date.now() + '.txt';
        fs.writeFileSync(testFile, 'test content');
        const absPath = path.resolve(testFile);
        
        console.log('1. Created file:', testFile);

        // 2. Create changelist
        const clSpec = 'Change: new\nDescription: Test Shelve Debug\n';
        const clOut = await run(`change -i <<EOF\n${clSpec}\nEOF`); 
        // Windows cmd might not handle <<EOF. Using echo | p4 change -i
        // But let's try to get a default pending CL first or use existing.
        // Actually, easiest is to use 'p4 change -i' with stdin, but passing stdin to exec is tricky in one line.
        // Let's just use existing logic or create a pending CL manually if possible.
        // Or just use default CL to add, then move? No, can't shelve default.
        
        // Let's assume we can use `p4 change -o` -> modify -> `p4 change -i` logic roughly
        // But to keep it simple, I'll use a safer way: 
        // Just list pending changelists and pick one if available, or just try to understand the output of `describe` first.
        
        // Let's just run describe on ANY pending changelist that has shelved files if possible.
        
        const changes = await run('changes -s pending -u ' + process.env.USERNAME);
        console.log('Pending changes:\n', changes);
        
        const match = changes.match(/Change (\d+)/);
        if (match) {
            const cl = match[1];
            console.log(`Running describe -S on CL ${cl}...`);
            const descOut = await run(`describe -S ${cl}`);
            console.log('--- OUTPUT START ---');
            console.log(descOut);
            console.log('--- OUTPUT END ---');
            
            // Test Regex
            const normalizedOutput = descOut.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const regex = /(?:Affected|Shelved) files \.\.\.\s+([\s\S]*?)(?=\nDifferences|$)/;
            const m = normalizedOutput.match(regex);
            if (m) {
                console.log('REGEX MATCHED!');
                console.log(m[1]);
            } else {
                console.log('REGEX FAILED MATCH');
            }
        } else {
            console.log('No pending changelists found to test.');
        }

        // Cleanup
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        
    } catch (e) {
        console.error(e);
    }
}

debugShelve();
