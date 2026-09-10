import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const asset = (name) => fileURLToPath(new URL(`../public/assets/${name}`, import.meta.url));
const source = readFileSync(asset("openerx-mark.svg"));
const png = (width) =>
  new Resvg(source, { fitTo: { mode: "width", value: width } }).render().asPng();
writeFileSync(asset("openerx-mark.png"), png(512));
// Modern ICO supports PNG frames. ICNS uses PNG payloads for these frame types.
const icoPng = png(256);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icoPng.length, 14);
icoHeader.writeUInt32LE(22, 18);
writeFileSync(asset("openerx.ico"), Buffer.concat([icoHeader, icoPng]));
const frames = [
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
].map(([type, width]) => {
  const data = png(width);
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns");
icnsHeader.writeUInt32BE(8 + frames.reduce((size, frame) => size + frame.length, 0), 4);
writeFileSync(asset("openerx.icns"), Buffer.concat([icnsHeader, ...frames]));
