import path from "path";
import fs from "fs";

export const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data");
export const PORT = parseInt(process.env.PORT || "4321", 10);

export const UPLOAD_DIR = path.join(DATA_PATH, "uploads");
export const CONVERTED_DIR = path.join(DATA_PATH, "converted");
export const SHARED_DIR = path.join(DATA_PATH, "shared_files");
export const METADATA_DIR = path.join(DATA_PATH, "metadata");

export function ensureDirectories(): void {
  [DATA_PATH, UPLOAD_DIR, CONVERTED_DIR, SHARED_DIR, METADATA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}
