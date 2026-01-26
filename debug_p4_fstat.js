const { spawn } = require('child_process');

function runCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('p4', args, { shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 || stdout) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    console.log('Running p4 -ztag fstat -Ro //...');
    const output = await runCommand(['-ztag', 'fstat', '-Ro', '//...']);
    console.log('Output length:', output.length);
    console.log('Raw output sample:');
    console.log(output.substring(0, 500));
    
    // Parse sample
    const match = output.match(/\.\.\. clientFile (.*)/);
    if (match) {
        console.log('Found clientFile in fstat:', match[1].trim());
    } else {
        console.log('clientFile not found in sample.');
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

main();
