import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { storage } from "./storage";
import { 
  conversionRequestSchema, 
  fileUploadRequestSchema,
  adminLoginRequestSchema,
  shareCreateRequestSchema,
  shareUpdateRequestSchema,
  shareAccessRequestSchema,
  type TempDriveFile,
  type TempDriveShare,
  type TempDriveShareFile,
  type TempDriveSession,
  type TempDriveBlockedIp,
  SHARE_QUOTA_BYTES
} from "@shared/schema";
import { UPLOAD_DIR, CONVERTED_DIR, SHARED_DIR, TEMP_DRIVE_DIR, getStorageInfo, isStorageNearFull } from "./config";
import {
  verifyAdminPassword,
  verifyPassword,
  hashPassword,
  generateTotpSecret,
  generateTotpQRCode,
  verifyTotp,
  generateSessionToken,
  generateShareToken,
  getSessionExpiryDate,
  isShareExpired
} from "./temp-drive-auth";

const execAsync = promisify(exec);

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

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

const MAX_LOGIN_ATTEMPTS = 3;
const BLOCK_DURATION_HOURS = 48;

async function checkAndRecordLoginAttempt(
  ip: string,
  type: "admin" | "share" | "home",
  shareId: string | null,
  success: boolean
): Promise<{ blocked: boolean; remainingAttempts: number }> {
  if (await storage.isIpBlocked(ip)) {
    return { blocked: true, remainingAttempts: 0 };
  }

  await storage.saveLoginAttempt({
    ip,
    type,
    shareId,
    success,
    timestamp: new Date().toISOString()
  });

  if (success) {
    return { blocked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS };
  }

  const attempts = await storage.getLoginAttempts(ip);
  const failedCount = attempts.length;

  if (failedCount >= MAX_LOGIN_ATTEMPTS) {
    const expiresAt = new Date(Date.now() + BLOCK_DURATION_HOURS * 60 * 60 * 1000).toISOString();
    const reason = type === "admin" ? "admin_login" : type === "home" ? "home_login" : "share_access";
    await storage.blockIp({
      ip,
      reason,
      shareId,
      blockedAt: new Date().toISOString(),
      expiresAt
    });
    return { blocked: true, remainingAttempts: 0 };
  }

  return { blocked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS - failedCount };
}

const SHARE_FOLDERS_DIR = path.join(TEMP_DRIVE_DIR, "shares");

function ensureShareFolderExists(folderId: string): string {
  const folderPath = path.join(SHARE_FOLDERS_DIR, folderId);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}

function deleteShareFolder(folderId: string): void {
  const folderPath = path.join(SHARE_FOLDERS_DIR, folderId);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
}

const ALLOWED_ANIMATED_TYPES = ["image/gif", "image/webp", "image/avif"];

const animatedImageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ANIMATED_TYPES.includes(file.mimetype)) {
      cb(new Error("Only GIF, animated WebP, or animated AVIF files are allowed"));
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

async function getImageMetadata(filePath: string, mimeType: string): Promise<{
  width: number;
  height: number;
  frames: number;
  format: string;
  isAnimated: boolean;
}> {
  try {
    const { stdout } = await execAsync(`identify -format "%w %h %n\\n" "${filePath}" 2>/dev/null | head -1`);
    const parts = stdout.trim().split(/\s+/);
    const width = parseInt(parts[0]) || 0;
    const height = parseInt(parts[1]) || 0;
    const frames = parseInt(parts[2]) || 1;
    
    let format = "unknown";
    if (mimeType === "image/gif") format = "GIF";
    else if (mimeType === "image/webp") format = "WebP";
    else if (mimeType === "image/avif") format = "AVIF";
    
    return { width, height, frames, format, isAnimated: frames > 1 };
  } catch (error) {
    return { width: 0, height: 0, frames: 1, format: "unknown", isAnimated: false };
  }
}

async function convertToGif(inputPath: string, outputPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync(`convert "${inputPath}" -coalesce "${outputPath}"`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Conversion to GIF failed" };
  }
}

async function getDominantEdgeColor(filePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `convert "${filePath}[0]" -resize 1x1! -format "%[pixel:u]" info:- 2>/dev/null`
    );
    const color = stdout.trim();
    if (color && color.match(/^(#[0-9a-fA-F]{6}|rgb\(|srgb\()/)) {
      return color;
    }
    return "#FFFFFF";
  } catch (error) {
    return "#FFFFFF";
  }
}

interface OptimizeOptions {
  maxSizeBytes: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowFrameReduction?: boolean;
}

interface OptimizeResult {
  success: boolean;
  error?: string;
  requiresApproval?: boolean;
  approvalMessage?: string;
  tempOutputPath?: string;
}

const MIN_DIMENSION = 180;
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Enhanced processing for animated images (GIF, WebP, AVIF):
 * - Output is ALWAYS GIF
 * - If either dimension < 180px, expand canvas with padding (no scaling)
 * - If both dimensions >= 180px, no resize/pad needed
 * - Uses dominant edge color for padding
 * - Preserves animation integrity
 */
async function ensureMinimumDimensions(
  inputPath: string,
  outputPath: string,
  minWidth: number = MIN_DIMENSION,
  minHeight: number = MIN_DIMENSION
): Promise<{ success: boolean; error?: string }> {
  try {
    const info = await getGifInfo(inputPath);
    
    const needsPadding = info.width < minWidth || info.height < minHeight;
    
    if (!needsPadding) {
      fs.copyFileSync(inputPath, outputPath);
      return { success: true };
    }
    
    const bgColor = await getDominantEdgeColor(inputPath);
    const newWidth = Math.max(info.width, minWidth);
    const newHeight = Math.max(info.height, minHeight);
    
    await execAsync(
      `convert "${inputPath}" -coalesce -gravity center -background "${bgColor}" -extent ${newWidth}x${newHeight} -layers optimize "${outputPath}"`
    );
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Dimension processing failed" };
  }
}

/**
 * Strict fallback optimization for animated GIF:
 * STEP 1: Non-destructive optimization (palette optimization, frame optimization)
 * STEP 2: Further color palette reduction (still non-destructive)
 * STEP 3: Return requiresApproval=true if frame reduction is needed
 * STEP 4: If approved and still fails, return hard stop error
 */
async function optimizeAnimatedGif(
  inputPath: string,
  outputPath: string,
  options: OptimizeOptions
): Promise<OptimizeResult> {
  try {
    let info = await getGifInfo(inputPath);
    const currentSize = fs.statSync(inputPath).size;
    const { maxSizeBytes, minWidth = MIN_DIMENSION, minHeight = MIN_DIMENSION, maxWidth, maxHeight, allowFrameReduction = false } = options;

    let workingPath = inputPath;
    let tempFiles: string[] = [];

    // Step -1: Resize if exceeds max dimensions (preserving aspect ratio)
    if ((maxWidth && info.width > maxWidth) || (maxHeight && info.height > maxHeight)) {
      const resizePath = inputPath + ".resize.gif";
      tempFiles.push(resizePath);
      
      let resizeSpec = "";
      if (maxWidth && maxHeight) {
        resizeSpec = `${maxWidth}x${maxHeight}`;
      } else if (maxWidth) {
        resizeSpec = `${maxWidth}x`;
      } else if (maxHeight) {
        resizeSpec = `x${maxHeight}`;
      }
      
      try {
        await execAsync(`convert "${inputPath}" -coalesce -resize "${resizeSpec}>" -layers optimize "${resizePath}"`);
        workingPath = resizePath;
        info = await getGifInfo(workingPath);
      } catch (resizeError: any) {
        console.error("Resize failed:", resizeError);
      }
    }

    // Step 0: Ensure minimum dimensions (padding only, no scaling)
    if (info.width < minWidth || info.height < minHeight) {
      const dimPath = workingPath + ".dim.gif";
      tempFiles.push(dimPath);
      const dimResult = await ensureMinimumDimensions(workingPath, dimPath, minWidth, minHeight);
      if (!dimResult.success) {
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        return dimResult;
      }
      workingPath = dimPath;
    }

    let resultSize = fs.statSync(workingPath).size;
    
    if (resultSize <= maxSizeBytes) {
      if (workingPath !== inputPath) {
        fs.renameSync(workingPath, outputPath);
        tempFiles = tempFiles.filter(f => f !== workingPath);
      } else {
        fs.copyFileSync(workingPath, outputPath);
      }
      tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      return { success: true };
    }

    // STEP 1: Standard GIF-safe optimizations (no frame loss)
    let cmd = `gifsicle -O3 --colors 256 "${workingPath}" -o "${outputPath}"`;
    await execAsync(cmd);
    resultSize = fs.statSync(outputPath).size;

    if (resultSize <= maxSizeBytes) {
      tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      return { success: true };
    }

    // STEP 2: Further palette reduction (still non-destructive)
    const colorLevels = [192, 128, 96, 64, 48, 32];
    for (const colors of colorLevels) {
      cmd = `gifsicle -O3 --colors ${colors} "${workingPath}" -o "${outputPath}"`;
      await execAsync(cmd);
      resultSize = fs.statSync(outputPath).size;
      if (resultSize <= maxSizeBytes) {
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        return { success: true };
      }
    }

    // Steps 1 & 2 failed - check if we can proceed with frame reduction
    if (!allowFrameReduction) {
      const estimatedFrameReduction = Math.ceil((1 - (maxSizeBytes / resultSize)) * 100);
      tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      return {
        success: false,
        requiresApproval: true,
        approvalMessage: `The file is still ${(resultSize / (1024 * 1024)).toFixed(2)}MB after optimization. To reach ${(maxSizeBytes / (1024 * 1024)).toFixed(1)}MB, approximately ${estimatedFrameReduction}% of frames may need to be removed. This will affect animation smoothness.`,
        tempOutputPath: outputPath
      };
    }

    // STEP 3: User approved - apply controlled frame reduction
    if (info.frames > 2) {
      const outputInfo = await getGifInfo(outputPath);
      let currentFrames = outputInfo.frames;
      
      while (resultSize > maxSizeBytes && currentFrames > 1) {
        const framesToKeep = Math.max(1, Math.floor(currentFrames * 0.85));
        
        if (framesToKeep >= currentFrames) break;
        
        const tempPath = outputPath + ".temp.gif";
        tempFiles.push(tempPath);
        fs.copyFileSync(outputPath, tempPath);
        
        const step = Math.ceil(currentFrames / framesToKeep);
        let frameSelector = [];
        for (let i = 0; i < currentFrames; i += step) {
          frameSelector.push(`#${i}`);
        }
        
        cmd = `gifsicle "${tempPath}" ${frameSelector.join(" ")} -o "${outputPath}"`;
        await execAsync(cmd);
        
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        tempFiles = tempFiles.filter(f => f !== tempPath);
        
        resultSize = fs.statSync(outputPath).size;
        currentFrames = framesToKeep;
      }
    }

    tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));

    // STEP 4: Hard stop if still over limit
    if (resultSize > maxSizeBytes) {
      return { 
        success: false, 
        error: `Conversion not possible without unacceptable quality loss. Best result: ${(resultSize / (1024 * 1024)).toFixed(2)}MB (target: ${(maxSizeBytes / (1024 * 1024)).toFixed(1)}MB)` 
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
      
      try {
        if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, SHARED_DIR)) {
          await fsPromises.unlink(filePath);
        }
      } catch (unlinkErr) {
        console.error(`Failed to delete file ${filePath}:`, unlinkErr);
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

async function cleanupTempFiles() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  
  const dirsToClean = [UPLOAD_DIR, CONVERTED_DIR];
  let cleanedCount = 0;
  
  for (const dir of dirsToClean) {
    try {
      if (!fs.existsSync(dir)) continue;
      
      const files = await fsPromises.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stats = await fsPromises.stat(filePath);
          const age = now - stats.mtimeMs;
          
          if (age > maxAge) {
            await fsPromises.unlink(filePath);
            cleanedCount++;
          }
        } catch (statErr) {
        }
      }
    } catch (readErr) {
      console.error(`Failed to read directory ${dir}:`, readErr);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} orphaned temp files`);
  }
}

// Middleware to check homepage authentication
function requireHomeAuth(req: any, res: any, next: any) {
  const isAuthenticated = req.session?.homeAuthenticated === true;
  const expiresAt = req.session?.homeAuthExpires;
  
  if (!isAuthenticated || !expiresAt || new Date(expiresAt) <= new Date()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  next();
}

// Routes that don't require home authentication
// Uses prefix matching - any path starting with these prefixes is public
const publicPathPrefixes = [
  "/health",
  "/home/",
  "/temp-drive/share/",
  "/download/",
  "/files/",
];

function isPublicPath(path: string): boolean {
  return publicPathPrefixes.some(prefix => path.startsWith(prefix));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  cron.schedule("* * * * *", cleanupExpiredFiles);
  cron.schedule("*/5 * * * *", cleanupTempFiles);

  // Apply home auth middleware to protected API routes
  app.use("/api", (req, res, next) => {
    if (isPublicPath(req.path)) {
      return next();
    }
    return requireHomeAuth(req, res, next);
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Homepage Authentication Routes
  // Uses express-session directly to avoid conflicts with Temp Drive admin sessions
  app.get("/api/home/session", async (req: any, res) => {
    if (!req.session) {
      return res.json({ authenticated: false });
    }
    
    const isAuthenticated = req.session.homeAuthenticated === true;
    const expiresAt = req.session.homeAuthExpires;
    
    if (!isAuthenticated || !expiresAt || new Date(expiresAt) <= new Date()) {
      req.session.homeAuthenticated = false;
      return res.json({ authenticated: false });
    }

    return res.json({ authenticated: true });
  });

  app.post("/api/home/login", async (req: any, res) => {
    if (!req.session) {
      return res.status(500).json({ message: "Session not available" });
    }
    
    const { password } = req.body;
    const clientIp = req.ip || "unknown";

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    // Check if IP is blocked
    const isBlocked = await storage.isIpBlocked(clientIp);
    if (isBlocked) {
      return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
    }

    // Verify admin password
    const isValidPassword = await verifyAdminPassword(password);
    if (!isValidPassword) {
      const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "home", null, false);
      if (blocked) {
        return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
      }
      return res.status(401).json({ message: `Invalid password. ${remainingAttempts} attempts remaining.` });
    }

    // Clear failed attempts on success
    await checkAndRecordLoginAttempt(clientIp, "home", null, true);

    // Store authentication state directly in session (separate from Temp Drive admin)
    req.session.homeAuthenticated = true;
    req.session.homeAuthExpires = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    // Explicitly save session before responding
    req.session.save((err: any) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ message: "Failed to save session" });
      }
      return res.json({ success: true });
    });
  });

  app.post("/api/home/logout", async (req: any, res) => {
    if (req.session) {
      req.session.homeAuthenticated = false;
      delete req.session.homeAuthExpires;
    }
    return res.json({ success: true });
  });

  app.post("/api/image/metadata", animatedImageUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const metadata = await getImageMetadata(req.file.path, req.file.mimetype);
      const fileSize = fs.statSync(req.file.path).size;

      fs.unlinkSync(req.file.path);

      res.json({
        width: metadata.width,
        height: metadata.height,
        fileSize,
        frames: metadata.frames,
        format: metadata.format,
        isAnimated: metadata.isAnimated
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ message: error.message || "Failed to get metadata" });
    }
  });

  app.post("/api/convert", animatedImageUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const mode = req.body.mode;
      const allowFrameReduction = req.body.allowFrameReduction === "true";
      
      if (mode !== "yalla_ludo" && mode !== "custom") {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Invalid conversion mode" });
      }

      const originalSize = fs.statSync(req.file.path).size;
      const originalFilename = req.file.originalname;
      const mimeType = req.file.mimetype;

      let workingPath = req.file.path;
      let tempGifPath: string | null = null;

      if (mimeType !== "image/gif") {
        tempGifPath = req.file.path + ".converted.gif";
        const convResult = await convertToGif(req.file.path, tempGifPath);
        if (!convResult.success) {
          fs.unlinkSync(req.file.path);
          return res.status(422).json({ message: convResult.error || "Failed to convert to GIF" });
        }
        workingPath = tempGifPath;
      }

      const originalInfo = await getGifInfo(workingPath);

      let optimizeOptions: OptimizeOptions;

      if (mode === "yalla_ludo") {
        optimizeOptions = {
          maxSizeBytes: MAX_SIZE_BYTES,
          minWidth: MIN_DIMENSION,
          minHeight: MIN_DIMENSION,
          allowFrameReduction
        };
      } else {
        const maxFileSize = parseFloat(req.body.maxFileSize || "2");
        const minWidth = parseInt(req.body.minWidth || "180") || MIN_DIMENSION;
        const minHeight = parseInt(req.body.minHeight || "180") || MIN_DIMENSION;
        const maxWidth = parseInt(req.body.maxWidth || "0") || 0;
        const maxHeight = parseInt(req.body.maxHeight || "0") || 0;

        if (maxFileSize <= 0 || maxFileSize > 50) {
          if (tempGifPath && fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid file size limit (must be 0.1-50 MB)" });
        }

        optimizeOptions = {
          maxSizeBytes: maxFileSize * 1024 * 1024,
          minWidth: Math.max(1, Math.min(minWidth, 2000)),
          minHeight: Math.max(1, Math.min(minHeight, 2000)),
          maxWidth: maxWidth > 0 ? Math.min(maxWidth, 4000) : undefined,
          maxHeight: maxHeight > 0 ? Math.min(maxHeight, 4000) : undefined,
          allowFrameReduction
        };
      }

      const outputId = randomUUID();
      const outputPath = path.join(CONVERTED_DIR, `${outputId}.gif`);

      const result = await optimizeAnimatedGif(workingPath, outputPath, optimizeOptions);

      if (tempGifPath && fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      if (result.requiresApproval) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        return res.status(200).json({
          id: outputId,
          success: false,
          requiresApproval: true,
          approvalMessage: result.approvalMessage,
          originalSize,
          originalWidth: originalInfo.width,
          originalHeight: originalInfo.height,
          frameCount: originalInfo.frames
        });
      }

      if (!result.success) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        return res.status(422).json({ message: result.error });
      }

      const finalSize = fs.statSync(outputPath).size;
      const finalInfo = await getGifInfo(outputPath);

      const version = storage.getNextConversionVersion();
      const versionStr = String(version).padStart(2, '0');
      const baseNameWithoutExt = path.basename(originalFilename, path.extname(originalFilename));
      const first3Chars = baseNameWithoutExt.slice(0, 3).replace(/[^a-zA-Z0-9]/g, 'x') || 'xxx';
      const downloadFilename = `${first3Chars}conv${versionStr}.gif`;

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
        downloadFilename,
        success: true
      }, outputId);

      res.json(conversionResult);
    } catch (error: any) {
      console.error("Conversion error:", error);
      res.status(500).json({ message: error.message || "Conversion failed" });
    }
  });

  app.get("/api/converted/:filename", async (req, res) => {
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

    const conversionResult = await storage.getConversionResult(fileId);
    const downloadName = conversionResult?.downloadFilename || sanitized;

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
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

  app.get("/api/files/info/:fileId", async (req, res) => {
    try {
      const fileId = req.params.fileId.split(".")[0];
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

      res.json({
        id: file.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        expiresAt: file.expiresAt,
        downloadUrl: file.downloadUrl
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get file info" });
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

  // ============== TEMP DRIVE ROUTES ==============

  const tempDriveUpload = multer({
    storage: multer.diskStorage({
      destination: TEMP_DRIVE_DIR,
      filename: (req, file, cb) => {
        const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        cb(null, uniqueName);
      }
    })
  });

  async function validateTempDriveSession(req: Request): Promise<{ valid: boolean; session: TempDriveSession | null; isAdmin: boolean }> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { valid: false, session: null, isAdmin: false };
    }
    
    const token = authHeader.substring(7);
    const session = await storage.getTempDriveSession(token);
    
    if (!session) {
      return { valid: false, session: null, isAdmin: false };
    }

    if (new Date(session.expiresAt) <= new Date()) {
      await storage.deleteTempDriveSession(token);
      return { valid: false, session: null, isAdmin: false };
    }

    if (session.type === "share" && session.shareId) {
      const share = await storage.getTempDriveShare(session.shareId);
      const globalSettings = await storage.getGlobalSettings();
      if (!share || !share.active || !globalSettings.sharingEnabled || isShareExpired(share.expiresAt)) {
        await storage.deleteTempDriveSession(token);
        return { valid: false, session: null, isAdmin: false };
      }
    }
    
    return { valid: true, session, isAdmin: session.type === "admin" };
  }

  app.get("/api/temp-drive/status", async (req, res) => {
    try {
      const admin = await storage.getTempDriveAdmin();
      const globalSettings = await storage.getGlobalSettings();
      const shares = await storage.getAllTempDriveShares();
      const activeShares = shares.filter(s => s.active && !isShareExpired(s.expiresAt)).length;

      res.json({
        totpSetupComplete: admin?.totpSetupComplete || false,
        sharingEnabled: globalSettings.sharingEnabled,
        activeShareCount: activeShares,
        totalShareCount: shares.length
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get status" });
    }
  });

  app.post("/api/temp-drive/admin/login", async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      
      if (await storage.isIpBlocked(clientIp)) {
        return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
      }

      const parsed = adminLoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const { password, otp } = parsed.data;

      const isValidPassword = await verifyAdminPassword(password);
      if (!isValidPassword) {
        const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "admin", null, false);
        if (blocked) {
          return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
        }
        return res.status(401).json({ message: `Invalid password. ${remainingAttempts} attempts remaining.` });
      }

      let admin = await storage.getTempDriveAdmin();

      if (!admin) {
        const totpSecret = generateTotpSecret();
        admin = {
          passwordHash: await hashPassword(password),
          totpSecret,
          totpSetupComplete: false,
          createdAt: new Date().toISOString()
        };
        await storage.saveTempDriveAdmin(admin);
      }

      if (!admin.totpSetupComplete) {
        // Generate new TOTP secret if it doesn't exist (e.g., after reset)
        if (!admin.totpSecret) {
          admin.totpSecret = generateTotpSecret();
          await storage.saveTempDriveAdmin(admin);
        }
        const qrCode = await generateTotpQRCode(admin.totpSecret);
        return res.json({
          requiresTotpSetup: true,
          qrCode,
          secret: admin.totpSecret
        });
      }

      if (!otp) {
        return res.status(400).json({ message: "OTP required", requiresOtp: true });
      }

      if (!admin.totpSecret || !verifyTotp(admin.totpSecret, otp)) {
        const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "admin", null, false);
        if (blocked) {
          return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
        }
        return res.status(401).json({ message: `Invalid OTP. ${remainingAttempts} attempts remaining.` });
      }

      await checkAndRecordLoginAttempt(clientIp, "admin", null, true);

      const sessionToken = generateSessionToken();
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "admin",
        shareId: null,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });

      res.json({ token: sessionToken, type: "admin" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Login failed" });
    }
  });

  app.post("/api/temp-drive/admin/setup-totp", async (req, res) => {
    try {
      const { password, otp } = req.body;

      const isValidPassword = await verifyAdminPassword(password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid password" });
      }

      const admin = await storage.getTempDriveAdmin();
      if (!admin || !admin.totpSecret) {
        return res.status(400).json({ message: "TOTP not initialized" });
      }

      if (!verifyTotp(admin.totpSecret, otp)) {
        return res.status(401).json({ message: "Invalid OTP" });
      }

      admin.totpSetupComplete = true;
      await storage.saveTempDriveAdmin(admin);

      const sessionToken = generateSessionToken();
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "admin",
        shareId: null,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });

      res.json({ token: sessionToken, type: "admin" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "TOTP setup failed" });
    }
  });

  app.post("/api/temp-drive/admin/logout", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        await storage.deleteTempDriveSession(token);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Logout failed" });
    }
  });

  app.get("/api/temp-drive/shares", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const shares = await storage.getAllTempDriveShares();
      const globalSettings = await storage.getGlobalSettings();
      res.json({ shares, sharingEnabled: globalSettings.sharingEnabled });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get shares" });
    }
  });

  app.post("/api/temp-drive/shares", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const parsed = shareCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const { label, password, expiryMinutes } = parsed.data;
      const passwordHash = password ? await hashPassword(password) : null;
      const shareToken = generateShareToken();
      const folderId = randomUUID();
      
      ensureShareFolderExists(folderId);
      
      const expiresAt = expiryMinutes 
        ? new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()
        : null;

      const share: TempDriveShare = {
        id: randomUUID(),
        label,
        token: shareToken,
        passwordHash,
        folderId,
        expiresAt,
        createdAt: new Date().toISOString(),
        active: true,
        usedBytes: 0
      };

      await storage.saveTempDriveShare(share);

      res.json({
        share,
        shareUrl: `/temp-drive/share/${shareToken}`
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create share" });
    }
  });

  app.patch("/api/temp-drive/shares/:id", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const { id } = req.params;
      const parsed = shareUpdateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const updates: Partial<TempDriveShare> = {};
      if (parsed.data.label !== undefined) updates.label = parsed.data.label;
      if (parsed.data.active !== undefined) updates.active = parsed.data.active;
      if (parsed.data.password !== undefined) {
        updates.passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;
      }
      if (parsed.data.expiryMinutes !== undefined) {
        updates.expiresAt = parsed.data.expiryMinutes 
          ? new Date(Date.now() + parsed.data.expiryMinutes * 60 * 1000).toISOString()
          : null;
      }

      const updated = await storage.updateTempDriveShare(id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Share not found" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update share" });
    }
  });

  app.delete("/api/temp-drive/shares/:id", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const { id } = req.params;
      const share = await storage.getTempDriveShare(id);
      if (share && share.folderId) {
        await storage.deleteAllShareFiles(share.id);
        deleteShareFolder(share.folderId);
      }

      const deleted = await storage.deleteTempDriveShare(id);
      if (!deleted) {
        return res.status(404).json({ message: "Share not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete share" });
    }
  });

  app.post("/api/temp-drive/global-sharing", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "Invalid request" });
      }

      await storage.saveGlobalSettings({ sharingEnabled: enabled });
      res.json({ sharingEnabled: enabled });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update global sharing" });
    }
  });

  app.post("/api/temp-drive/share/access/:token", async (req, res) => {
    try {
      console.log("Share access request for token:", req.params.token);
      const clientIp = getClientIp(req);
      
      if (await storage.isIpBlocked(clientIp)) {
        return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
      }

      const globalSettings = await storage.getGlobalSettings();
      if (!globalSettings.sharingEnabled) {
        return res.status(403).json({ message: "Sharing is currently disabled" });
      }

      const { token } = req.params;
      const share = await storage.getTempDriveShareByToken(token);
      console.log("Share found:", share ? share.id : "null");
      
      if (!share || !share.active) {
        return res.status(404).json({ message: "Share not found or disabled" });
      }

      if (isShareExpired(share.expiresAt)) {
        if (share.folderId) {
          await storage.deleteAllShareFiles(share.id);
          deleteShareFolder(share.folderId);
        }
        await storage.deleteTempDriveShare(share.id);
        return res.status(410).json({ message: "Share has expired" });
      }

      if (share.passwordHash) {
        const parsed = shareAccessRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Password required" });
        }

        console.log("Verifying password...");
        const isValidPassword = await verifyPassword(parsed.data.password, share.passwordHash);
        console.log("Password valid:", isValidPassword);
        
        if (!isValidPassword) {
          const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "share", share.id, false);
          if (blocked) {
            return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
          }
          return res.status(401).json({ message: `Invalid password. ${remainingAttempts} attempts remaining.` });
        }
      }

      await checkAndRecordLoginAttempt(clientIp, "share", share.id, true);

      const sessionToken = generateSessionToken();
      console.log("Creating session...");
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "share",
        shareId: share.id,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });
      console.log("Session created successfully");

      res.json({ token: sessionToken, type: "share", shareId: share.id });
    } catch (error: any) {
      console.error("Share access error:", error);
      res.status(500).json({ message: error.message || "Access failed" });
    }
  });

  app.get("/api/temp-drive/share/validate/:token", async (req, res) => {
    try {
      const globalSettings = await storage.getGlobalSettings();
      if (!globalSettings.sharingEnabled) {
        return res.json({ valid: false, requiresPassword: false });
      }

      const { token } = req.params;
      const share = await storage.getTempDriveShareByToken(token);
      
      if (!share || !share.active) {
        return res.json({ valid: false, requiresPassword: false });
      }

      if (isShareExpired(share.expiresAt)) {
        if (share.folderId) {
          await storage.deleteAllShareFiles(share.id);
          deleteShareFolder(share.folderId);
        }
        await storage.deleteTempDriveShare(share.id);
        return res.json({ valid: false, requiresPassword: false });
      }

      res.json({ valid: true, requiresPassword: !!share.passwordHash, label: share.label });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Validation failed" });
    }
  });

  app.get("/api/temp-drive/files", async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        return res.status(401).json({ message: "Authentication required" });
      }

      if (isAdmin) {
        const shareIdQuery = req.query.shareId as string | undefined;
        if (shareIdQuery) {
          const share = await storage.getTempDriveShare(shareIdQuery);
          if (!share) {
            return res.status(404).json({ message: "Share not found" });
          }
          const files = await storage.getShareFiles(share.id);
          res.json({ files, quota: { usedBytes: share.usedBytes, totalBytes: SHARE_QUOTA_BYTES } });
        } else {
          const files = await storage.getTempDriveFiles();
          res.json(files);
        }
      } else {
        if (!session.shareId) {
          return res.status(404).json({ message: "Share not found" });
        }
        const share = await storage.getTempDriveShare(session.shareId);
        if (!share) {
          return res.status(404).json({ message: "Share not found" });
        }
        const files = await storage.getShareFiles(share.id);
        res.json({ files, quota: { usedBytes: share.usedBytes, totalBytes: SHARE_QUOTA_BYTES } });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get files" });
    }
  });

  app.post("/api/temp-drive/files/upload", tempDriveUpload.single("file"), async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(401).json({ message: "Authentication required" });
      }

      if (isStorageNearFull()) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(507).json({ message: "Storage is 95% full. Cannot upload more files." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const fileId = randomUUID();
      const safeExt = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      const diskFileName = `${fileId}${safeExt}`;

      if (isAdmin) {
        const newPath = path.join(TEMP_DRIVE_DIR, diskFileName);
        
        if (!isPathWithinDirectory(newPath, TEMP_DRIVE_DIR)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid file path" });
        }
        
        fs.renameSync(req.file.path, newPath);

        const tempDriveFile: TempDriveFile = {
          id: fileId,
          fileName: req.file.originalname,
          diskFileName,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          uploadedAt: new Date().toISOString(),
          uploadedBy: "admin"
        };

        await storage.saveTempDriveFile(tempDriveFile);
        res.json(tempDriveFile);
      } else {
        if (!session.shareId) {
          fs.unlinkSync(req.file.path);
          return res.status(404).json({ message: "Share not found" });
        }
        const share = await storage.getTempDriveShare(session.shareId);
        if (!share || !share.folderId) {
          fs.unlinkSync(req.file.path);
          return res.status(404).json({ message: "Share not found" });
        }

        if (share.usedBytes + req.file.size > SHARE_QUOTA_BYTES) {
          fs.unlinkSync(req.file.path);
          return res.status(507).json({ message: "Storage quota exceeded. Maximum 1GB per share." });
        }

        const folderPath = path.join(SHARE_FOLDERS_DIR, share.folderId);
        const newPath = path.join(folderPath, diskFileName);
        
        if (!isPathWithinDirectory(newPath, folderPath)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid file path" });
        }
        
        ensureShareFolderExists(share.folderId);
        fs.renameSync(req.file.path, newPath);

        const shareFile: TempDriveShareFile = {
          id: fileId,
          shareId: share.id,
          fileName: req.file.originalname,
          diskFileName,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          uploadedAt: new Date().toISOString()
        };

        await storage.saveShareFile(shareFile);
        await storage.updateTempDriveShare(share.id, { usedBytes: share.usedBytes + req.file.size });
        res.json(shareFile);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  function getDiskFileName(file: TempDriveFile): string {
    if (file.diskFileName) {
      return file.diskFileName;
    }
    const safeExt = path.extname(file.fileName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    return `${file.id}${safeExt}`;
  }

  app.get("/api/temp-drive/files/download/:id", async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      if (isAdmin) {
        const files = await storage.getTempDriveFiles();
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const diskName = getDiskFileName(file);
        const filePath = path.join(TEMP_DRIVE_DIR, diskName);
        
        if (!isPathWithinDirectory(filePath, TEMP_DRIVE_DIR) || !fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }

        const safeFileName = file.fileName.replace(/[^\w\s.-]/gi, '_');
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
        res.sendFile(filePath);
      } else {
        if (!session.shareId) {
          return res.status(404).json({ message: "Share not found" });
        }
        const share = await storage.getTempDriveShare(session.shareId);
        if (!share || !share.folderId) {
          return res.status(404).json({ message: "Share not found" });
        }

        const files = await storage.getShareFiles(share.id);
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const folderPath = path.join(SHARE_FOLDERS_DIR, share.folderId);
        const filePath = path.join(folderPath, file.diskFileName);
        
        if (!isPathWithinDirectory(filePath, folderPath) || !fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }

        const safeFileName = file.fileName.replace(/[^\w\s.-]/gi, '_');
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
        res.sendFile(filePath);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Download failed" });
    }
  });

  app.delete("/api/temp-drive/files/:id", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      const shareIdQuery = req.query.shareId as string | undefined;
      
      if (shareIdQuery) {
        const share = await storage.getTempDriveShare(shareIdQuery);
        if (!share || !share.folderId) {
          return res.status(404).json({ message: "Share not found" });
        }

        const files = await storage.getShareFiles(share.id);
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const folderPath = path.join(SHARE_FOLDERS_DIR, share.folderId);
        const filePath = path.join(folderPath, file.diskFileName);
        
        if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, folderPath)) {
          fs.unlinkSync(filePath);
        }

        await storage.deleteShareFile(fileId);
        await storage.updateTempDriveShare(share.id, { usedBytes: Math.max(0, share.usedBytes - file.fileSize) });
        res.json({ success: true });
      } else {
        const files = await storage.getTempDriveFiles();
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const diskName = getDiskFileName(file);
        const filePath = path.join(TEMP_DRIVE_DIR, diskName);
        
        if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, TEMP_DRIVE_DIR)) {
          fs.unlinkSync(filePath);
        }

        await storage.deleteTempDriveFile(fileId);
        res.json({ success: true });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete failed" });
    }
  });

  app.delete("/api/temp-drive/files", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const files = await storage.getTempDriveFiles();
      for (const file of files) {
        const diskName = getDiskFileName(file);
        const filePath = path.join(TEMP_DRIVE_DIR, diskName);
        if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, TEMP_DRIVE_DIR)) {
          fs.unlinkSync(filePath);
        }
      }

      await storage.deleteAllTempDriveFiles();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete all failed" });
    }
  });

  app.get("/api/temp-drive/blocked-ips", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const blockedIps = await storage.getBlockedIps();
      res.json(blockedIps);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get blocked IPs" });
    }
  });

  app.delete("/api/temp-drive/blocked-ips/:ip", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const ip = decodeURIComponent(req.params.ip);
      await storage.unblockIp(ip);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to unblock IP" });
    }
  });

  app.get("/api/temp-drive/storage", async (req, res) => {
    try {
      const info = getStorageInfo();
      res.json({
        usedBytes: info.usedBytes,
        totalBytes: info.totalBytes,
        usedPercentage: Math.round(info.usedPercentage * 100) / 100,
        warning: info.usedPercentage >= 95
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get storage info" });
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    try {
      await storage.cleanExpiredSessions();
      await storage.cleanOldLoginAttempts();
      await storage.cleanExpiredBlocks();
      
      const shares = await storage.getAllTempDriveShares();
      for (const share of shares) {
        if (share.active && isShareExpired(share.expiresAt)) {
          if (share.folderId) {
            await storage.deleteAllShareFiles(share.id);
            deleteShareFolder(share.folderId);
          }
          await storage.deleteTempDriveShare(share.id);
          console.log(`Expired share ${share.id} and its folder cleaned up`);
        }
      }
    } catch (error) {
      console.error("Error cleaning up temp drive:", error);
    }
  });

  return httpServer;
}
