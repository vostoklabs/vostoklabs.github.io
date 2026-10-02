const fs = require('fs');
const path = require('path');

function processFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules') processFiles(fullPath);
        } else if (file === 'threemfExport.ts' || file === 'export3mf.js' || file === 'index.ts') {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;
            if (!content.includes('PartName="/Metadata/project_settings.config"')) {
                content = content.replace('<Default Extension="config" ContentType="text/xml"/>', '<Default Extension="config" ContentType="text/xml"/>\' +\n    \'<Override PartName="/Metadata/project_settings.config" ContentType="application/json"/>');
                changed = true;
            }
            if (!content.includes('xmlns:bambu=')) {
                content = content.replace('xmlns:BambuStudio="${BBL_NS}"', 'xmlns:bambu="${BBL_NS}"\' +\n    \' xmlns:BambuStudio="${BBL_NS}"\' +\n    \' xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"');
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Updated', fullPath);
            }
        }
    }
}
processFiles('apps');
