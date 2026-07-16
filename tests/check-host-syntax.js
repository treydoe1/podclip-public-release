const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hostPath = path.join(__dirname, "..", "host", "host.jsx");
const source = fs.readFileSync(hostPath, "utf8").replace(/^#target[^\n]*\n/m, "");
new vm.Script(source, { filename: hostPath });
console.log("ExtendScript syntax check passed");
