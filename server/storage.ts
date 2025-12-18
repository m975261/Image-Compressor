import { randomUUID } from "crypto";
import type { UploadedFile, ConversionResult } from "@shared/schema";

export interface IStorage {
  saveUploadedFile(file: Omit<UploadedFile, "id">, customId?: string): Promise<UploadedFile>;
  getUploadedFile(id: string): Promise<UploadedFile | undefined>;
  getAllUploadedFiles(): Promise<UploadedFile[]>;
  deleteUploadedFile(id: string): Promise<boolean>;
  getExpiredFiles(): Promise<UploadedFile[]>;
  
  saveConversionResult(result: Omit<ConversionResult, "id">): Promise<ConversionResult>;
  getConversionResult(id: string): Promise<ConversionResult | undefined>;
}

export class MemStorage implements IStorage {
  private uploadedFiles: Map<string, UploadedFile>;
  private conversionResults: Map<string, ConversionResult>;

  constructor() {
    this.uploadedFiles = new Map();
    this.conversionResults = new Map();
  }

  async saveUploadedFile(file: Omit<UploadedFile, "id">, customId?: string): Promise<UploadedFile> {
    const id = customId || randomUUID();
    const uploadedFile: UploadedFile = { ...file, id };
    this.uploadedFiles.set(id, uploadedFile);
    return uploadedFile;
  }

  async getUploadedFile(id: string): Promise<UploadedFile | undefined> {
    return this.uploadedFiles.get(id);
  }

  async getAllUploadedFiles(): Promise<UploadedFile[]> {
    return Array.from(this.uploadedFiles.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async deleteUploadedFile(id: string): Promise<boolean> {
    return this.uploadedFiles.delete(id);
  }

  async getExpiredFiles(): Promise<UploadedFile[]> {
    const now = new Date();
    return Array.from(this.uploadedFiles.values()).filter(
      file => new Date(file.expiresAt) <= now
    );
  }

  async saveConversionResult(result: Omit<ConversionResult, "id">): Promise<ConversionResult> {
    const id = randomUUID();
    const conversionResult: ConversionResult = { ...result, id };
    this.conversionResults.set(id, conversionResult);
    return conversionResult;
  }

  async getConversionResult(id: string): Promise<ConversionResult | undefined> {
    return this.conversionResults.get(id);
  }
}

export const storage = new MemStorage();
