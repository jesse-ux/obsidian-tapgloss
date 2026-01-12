import fs from "node:fs";

const version = process.argv[2];

if (!version) {
  console.error("Usage: node scripts/bump-version.mjs <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Version must be in the form x.y.z");
  process.exit(1);
}

const updateJson = (path, updater) => {
  if (!fs.existsSync(path)) return;
  const raw = fs.readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  updater(data);
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

updateJson("manifest.json", (data) => {
  data.version = version;
});

updateJson("package.json", (data) => {
  data.version = version;
});

updateJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
});

console.log(`Version updated to ${version}`);
