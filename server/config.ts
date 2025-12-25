import path from "path";
import fs from "fs";
import { execSync } from "child_process";

export const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data");
export const PORT = parseInt(process.env.PORT || "4321", 10);

export const UPLOAD_DIR = path.join(DATA_PATH, "uploads");
export const CONVERTED_DIR = path.join(DATA_PATH, "converted");
export const SHARED_DIR = path.join(DATA_PATH, "shared_files");
export const METADATA_DIR = path.join(DATA_PATH, "metadata");
export const TEMP_DRIVE_DIR = path.join(DATA_PATH, "temp_drive");

export function ensureDirectories(): void {
  [DATA_PATH, UPLOAD_DIR, CONVERTED_DIR, SHARED_DIR, METADATA_DIR, TEMP_DRIVE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

export interface StorageInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercentage: number;
}

export function getStorageInfo(): StorageInfo {
  try {
    const dfOutput = execSync(`df -B1 "${DATA_PATH}" 2>/dev/null || df -k "${DATA_PATH}"`).toString();
    const lines = dfOutput.trim().split("\n");
    if (lines.length < 2) {
      return getDefaultStorageInfo();
    }
    
    const parts = lines[1].split(/\s+/);
    if (parts.length < 4) {
      return getDefaultStorageInfo();
    }
    
    let totalBytes: number, usedBytes: number, availableBytes: number;
    
    if (dfOutput.includes("-B1")) {
      totalBytes = parseInt(parts[1]) || 0;
      usedBytes = parseInt(parts[2]) || 0;
      availableBytes = parseInt(parts[3]) || 0;
    } else {
      totalBytes = (parseInt(parts[1]) || 0) * 1024;
      usedBytes = (parseInt(parts[2]) || 0) * 1024;
      availableBytes = (parseInt(parts[3]) || 0) * 1024;
    }
    
    const usedPercentage = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    
    return { totalBytes, usedBytes, availableBytes, usedPercentage };
  } catch (error) {
    return getDefaultStorageInfo();
  }
}

function getDefaultStorageInfo(): StorageInfo {
  return {
    totalBytes: 10 * 1024 * 1024 * 1024,
    usedBytes: 0,
    availableBytes: 10 * 1024 * 1024 * 1024,
    usedPercentage: 0,
  };
}

export function isStorageNearFull(): boolean {
  const info = getStorageInfo();
  return info.usedPercentage >= 95;
}
