const fs = require('fs');
const path = "c:/Users/hp/Documents/grizon-ai-frontend2/Grizon-AI-Frontend-v2/components/chat/Messages.tsx";

let content = fs.readFileSync(path, 'utf8').split('\n');
let newContent = [];

for (let line of content) {
    if (line.includes('<<<<<<< HEAD') || line.includes('=======') || line.includes('>>>>>>>')) {
        continue;
    }
    newContent.push(line);
}

fs.writeFileSync(path, newContent.join('\n'));
