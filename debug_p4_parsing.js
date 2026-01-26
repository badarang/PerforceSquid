// Mock P4 Service Logic
class P4ServiceMock {
  mapZtagToFile(data) {
    const changelist = data.change === 'default' ? 'default' : parseInt(data.change, 10)
    return {
      depotFile: data.depotFile,
      clientFile: data.clientFile || '',
      action: data.action || 'edit',
      changelist: isNaN(changelist) && changelist !== 'default' ? 'default' : changelist,
      type: data.type || 'text'
    }
  }

  parseOpened(output) {
    if (!output.trim()) {
      return []
    }

    const files = []
    // Robust splitting: handle \r\n, \r, and \n
    const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    
    let currentFile = {}
    
    const pushCurrentFile = () => {
      if (currentFile.depotFile) {
        files.push(this.mapZtagToFile(currentFile))
      }
      currentFile = {}
    }

    for (const line of lines) {
      const trimmed = line.trim()
      
      // Blank line usually separates records in -Ztag output
      if (!trimmed) {
        pushCurrentFile()
        continue
      }

      // Parse ztag line: "... key value"
      const match = line.match(/^... ([a-zA-Z0-9]+) (.*)$/)
      if (!match) continue
      
      const key = match[1]
      const value = match[2].trim()
      
      // Safety check: if we see depotFile and we already have one, it's a new record
      if (key === 'depotFile' && currentFile.depotFile) {
        pushCurrentFile()
      }

      currentFile[key] = value
    }
    
    // Push the last file
    pushCurrentFile()

    return files
  }
}

const mock = new P4ServiceMock()

// Test Case 1: Standard Output
// NOTE: We must escape backslashes in the input string to simulate raw output correctly
// otherwise 'badar' becomes '\b' (backspace) + 'adar'
const input1 = `... depotFile //depot/Game_GarageState4.cs
... clientFile c:\\Users\\badar\\Perforce\\hoh_haein_Refactor\\AeroRacer\\Game_GarageState4.cs
... action edit
... change default
... type text
`

// Test Case 2: Windows Line Endings & Weird Order
const input2 = `... action edit\r
... clientFile c:\\Users\\badar\\Perforce\\hoh_haein_Refactor\\AeroRacer\\Game_GarageState4.cs\r
... depotFile //depot/Game_GarageState4.cs\r
... change default\r
\r
... depotFile //depot/AnotherFile.cs\r
... clientFile c:\\Path\\AnotherFile.cs\r
`

// Test Case 3: Missing Blank Line
const input3 = `... depotFile //depot/Game_GarageState4.cs
... clientFile c:\\Path\\Game_GarageState4.cs
... depotFile //depot/NextFile.cs
... clientFile c:\\Path\\NextFile.cs
`

console.log("--- Test Case 1 (Regex) ---")
console.log(JSON.stringify(mock.parseOpened(input1), null, 2))

console.log("\n--- Test Case 2 (Regex) ---")
console.log(JSON.stringify(mock.parseOpened(input2), null, 2))

console.log("\n--- Test Case 3 (Regex) ---")
console.log(JSON.stringify(mock.parseOpened(input3), null, 2))


// Production Parsing Logic (from p4Service.ts)
function parseOpenedProduction(output) {
    if (!output.trim()) {
      return []
    }

    const files = []
    const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    
    let currentFile = {}
    
    const pushCurrentFile = () => {
      if (currentFile.depotFile) {
        files.push(mock.mapZtagToFile(currentFile))
      }
      currentFile = {}
    }

    for (const line of lines) {
      const trimmed = line.trim()
      
      if (!trimmed) {
        pushCurrentFile()
        continue
      }

      if (!line.startsWith('... ')) continue
      
      const keyStart = 4 
      const keyEnd = line.indexOf(' ', keyStart)
      
      if (keyEnd === -1) continue 
      
      const key = line.substring(keyStart, keyEnd)
      const value = line.substring(keyEnd + 1).trim()
      
      if (key === 'depotFile' && currentFile.depotFile) {
        pushCurrentFile()
      }

      currentFile[key] = value
    }
    
    pushCurrentFile()
    return files
}

console.log("\n--- Test Case 1 (Production Logic) ---")
console.log(JSON.stringify(parseOpenedProduction(input1), null, 2))


// Test Case 4: File splitting check
const path = "c:\\Users\\badar\\Perforce\\hoh_haein_Refactor\\AeroRacer\\Game_GarageState4.cs"
const name = path.replace(/[///\\]+$/, '').split(/[///\\]/).pop()
console.log("\n--- Path Splitting Check ---")
console.log(`Path: ${path}`)
console.log(`Extracted Name: ${name}`)
