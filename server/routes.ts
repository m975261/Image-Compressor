import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { storage } from "./storage";
import { conversionRequestSchema, fileUploadRequestSchema } from "@shared/schema";

const execAsync = promisify(exec);

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const CONVERTED_DIR = path.join(process.cwd(), "converted");
const SHARED_DIR = path.join(process.cwd(), "shared_files");

[UPLOAD_DIR, CONVERTED_DIR, SHARED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function sanitizeFilename(filename: string): string | null {
  const basename = path.basename(filename);
  if (basename !== filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  return basename;
}

function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return resolvedPath.startsWith(resolvedDir + path.sep) || resolvedPath === resolvedDir;
}

const gifUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "image/gif") {
      cb(new Error("Only GIF files are allowed"));
      return;
    }
    cb(null, true);
  }
});

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: SHARED_DIR,
    filename: (req, file, cb) => {
      const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

async function getGifInfo(filePath: string): Promise<{ width: number; height: number; frames: number }> {
  try {
    const { stdout } = await execAsync(`gifsicle --info "${filePath}" 2>&1 | head -20`);
    
    const sizeMatch = stdout.match(/logical screen (\d+)x(\d+)/);
    const frameMatch = stdout.match(/(\d+) images?/);
    
    return {
      width: sizeMatch ? parseInt(sizeMatch[1]) : 0,
      height: sizeMatch ? parseInt(sizeMatch[2]) : 0,
      frames: frameMatch ? parseInt(frameMatch[1]) : 1
    };
  } catch (error) {
    return { width: 0, height: 0, frames: 1 };
  }
}

async function optimizeGif(
  inputPath: string,
  outputPath: string,
  maxWidth: number,
  maxHeight: number,
  maxSizeBytes: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const info = await getGifInfo(inputPath);
    const currentSize = fs.statSync(inputPath).size;
    
    if (currentSize <= maxSizeBytes && info.width <= maxWidth && info.height <= maxHeight) {
      fs.copyFileSync(inputPath, outputPath);
      return { success: true };
    }

    let scale = 1;
    if (info.width > maxWidth || info.height > maxHeight) {
      const widthScale = maxWidth / info.width;
      const heightScale = maxHeight / info.height;
      scale = Math.min(widthScale, heightScale);
    }

    const newWidth = Math.floor(info.width * scale);
    const newHeight = Math.floor(info.height * scale);

    let cmd = `gifsicle -O3 --resize ${newWidth}x${newHeight} --colors 256 "${inputPath}" -o "${outputPath}"`;
    await execAsync(cmd);

    let resultSize = fs.statSync(outputPath).size;
    
    if (resultSize > maxSizeBytes) {
      cmd = `gifsicle -O3 --resize ${newWidth}x${newHeight} --colors 128 "${inputPath}" -o "${outputPath}"`;
      await execAsync(cmd);
      resultSize = fs.statSync(outputPath).size;
    }

    if (resultSize > maxSizeBytes) {
      cmd = `gifsicle -O3 --resize ${newWidth}x${newHeight} --colors 64 "${inputPath}" -o "${outputPath}"`;
      await execAsync(cmd);
      resultSize = fs.statSync(outputPath).size;
    }

    if (resultSize > maxSizeBytes && info.frames > 1) {
      const outputInfo = await getGifInfo(outputPath);
      const framesToKeep = Math.max(1, Math.floor(outputInfo.frames * (maxSizeBytes / resultSize)));
      
      if (framesToKeep < outputInfo.frames) {
        const tempPath = outputPath + ".temp.gif";
        fs.copyFileSync(outputPath, tempPath);
        
        cmd = `gifsicle "${tempPath}" "#0-${framesToKeep - 1}" -o "${outputPath}"`;
        await execAsync(cmd);
        
        fs.unlinkSync(tempPath);
        resultSize = fs.statSync(outputPath).size;
      }
    }

    if (resultSize > maxSizeBytes) {
      return { 
        success: false, 
        error: `Could not reduce file to ${(maxSizeBytes / (1024 * 1024)).toFixed(1)}MB. Best result: ${(resultSize / (1024 * 1024)).toFixed(2)}MB` 
      };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Optimization failed" };
  }
}

async function cleanupExpiredFiles() {
  try {
    const expiredFiles = await storage.getExpiredFiles();
    
    for (const file of expiredFiles) {
      const ext = path.extname(file.fileName);
      const filePath = path.join(SHARED_DIR, file.id + ext);
      
      if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, SHARED_DIR)) {
        fs.unlinkSync(filePath);
      }
      
      await storage.deleteUploadedFile(file.id);
    }
    
    if (expiredFiles.length > 0) {
      console.log(`Cleaned up ${expiredFiles.length} expired files`);
    }
  } catch (error) {
    console.error("Error cleaning up expired files:", error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  cron.schedule("* * * * *", cleanupExpiredFiles);

  app.post("/api/convert", gifUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const mode = req.body.mode;
      if (mode !== "yalla_ludo" && mode !== "custom") {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Invalid conversion mode" });
      }

      let maxFileSize: number;
      let maxWidth: number;
      let maxHeight: number;

      if (mode === "yalla_ludo") {
        maxFileSize = 2 * 1024 * 1024;
        maxWidth = 180;
        maxHeight = 180;
      } else {
        const parsed = conversionRequestSchema.safeParse({
          mode: "custom",
          maxFileSize: parseFloat(req.body.maxFileSize || "2"),
          maxWidth: parseInt(req.body.maxWidth || "180"),
          maxHeight: parseInt(req.body.maxHeight || "180"),
        });

        if (!parsed.success) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid custom settings" });
        }

        maxFileSize = (parsed.data.maxFileSize || 2) * 1024 * 1024;
        maxWidth = parsed.data.maxWidth || 180;
        maxHeight = parsed.data.maxHeight || 180;
      }

      const originalInfo = await getGifInfo(req.file.path);
      const originalSize = fs.statSync(req.file.path).size;

      const outputId = randomUUID();
      const outputPath = path.join(CONVERTED_DIR, `${outputId}.gif`);

      const result = await optimizeGif(
        req.file.path,
        outputPath,
        maxWidth,
        maxHeight,
        maxFileSize
      );

      fs.unlinkSync(req.file.path);

      if (!result.success) {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        return res.status(422).json({ message: result.error });
      }

      const finalSize = fs.statSync(outputPath).size;
      const finalInfo = await getGifInfo(outputPath);

      const conversionResult = await storage.saveConversionResult({
        originalSize,
        finalSize,
        originalWidth: originalInfo.width,
        originalHeight: originalInfo.height,
        finalWidth: finalInfo.width,
        finalHeight: finalInfo.height,
        frameCount: finalInfo.frames,
        downloadUrl: `/api/converted/${outputId}.gif`,
        previewUrl: `/api/converted/${outputId}.gif`,
        success: true
      });

      res.json(conversionResult);
    } catch (error: any) {
      console.error("Conversion error:", error);
      res.status(500).json({ message: error.message || "Conversion failed" });
    }
  });

  app.get("/api/converted/:filename", (req, res) => {
    const sanitized = sanitizeFilename(req.params.filename);
    if (!sanitized) {
      return res.status(400).json({ message: "Invalid filename" });
    }

    if (!sanitized.endsWith(".gif")) {
      return res.status(400).json({ message: "Invalid file type" });
    }

    const fileId = sanitized.replace(".gif", "");
    if (!isValidUUID(fileId)) {
      return res.status(400).json({ message: "Invalid file identifier" });
    }

    const filePath = path.join(CONVERTED_DIR, sanitized);
    
    if (!isPathWithinDirectory(filePath, CONVERTED_DIR)) {
      return res.status(400).json({ message: "Invalid file path" });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitized}"`);
    res.sendFile(filePath);
  });

  app.post("/api/files/upload", fileUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const parsed = fileUploadRequestSchema.safeParse({
        expiryHours: parseFloat(req.body.expiryHours || "24")
      });

      let expiryHours = parsed.success ? parsed.data.expiryHours : 24;
      if (expiryHours <= 0 || expiryHours > 24) {
        expiryHours = 24;
      }

      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
      const fileId = randomUUID();

      const ext = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '';
      const newPath = path.join(SHARED_DIR, fileId + ext);
      fs.renameSync(req.file.path, newPath);

      const uploadedFile = await storage.saveUploadedFile({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        downloadUrl: `/api/files/download/${fileId}${ext}`,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString()
      }, fileId);

      res.json(uploadedFile);
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  app.get("/api/files", async (req, res) => {
    try {
      const files = await storage.getAllUploadedFiles();
      const validFiles = files.filter(file => new Date(file.expiresAt) > new Date());
      res.json(validFiles);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get files" });
    }
  });

  app.get("/api/files/download/:filename", async (req, res) => {
    try {
      const sanitized = sanitizeFilename(req.params.filename);
      if (!sanitized) {
        return res.status(400).json({ message: "Invalid filename" });
      }

      const fileId = sanitized.split(".")[0];
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }
      
      const file = await storage.getUploadedFile(fileId);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      if (new Date(file.expiresAt) <= new Date()) {
        return res.status(410).json({ message: "File has expired" });
      }

      const filePath = path.join(SHARED_DIR, sanitized);
      
      if (!isPathWithinDirectory(filePath, SHARED_DIR)) {
        return res.status(400).json({ message: "Invalid file path" });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Download failed" });
    }
  });

  app.delete("/api/files/:id", async (req, res) => {
    try {
      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      const file = await storage.getUploadedFile(fileId);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const ext = path.extname(file.fileName).replace(/[^a-zA-Z0-9.]/g, '') || '';
      const filePath = path.join(SHARED_DIR, fileId + ext);
      
      if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, SHARED_DIR)) {
        fs.unlinkSync(filePath);
      }

      await storage.deleteUploadedFile(fileId);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete failed" });
    }
  });

  return httpServer;
}
