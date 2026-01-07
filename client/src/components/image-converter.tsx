import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Upload, 
  Download, 
  AlertCircle, 
  CheckCircle, 
  Loader2,
  X,
  FileImage,
  AlertTriangle,
  Info
} from "lucide-react";
import { uploadWithProgress, UploadProgress } from "@/lib/upload-with-progress";
import type { ConversionMode, ConversionResult, ImageMetadata } from "@shared/schema";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/gif", "image/webp", "image/avif"];

interface CustomSettings {
  maxFileSize: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export function ImageConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ConversionMode | null>(null);
  const [customSettings, setCustomSettings] = useState<CustomSettings>({
    maxFileSize: 2,
    minWidth: 180,
    minHeight: 180,
    maxWidth: 0,
    maxHeight: 0,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [conversionStatus, setConversionStatus] = useState<string>("");
  const [approvalDialog, setApprovalDialog] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const validateAnimatedImage = useCallback((file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Please upload a GIF, animated WebP, or animated AVIF file";
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      return "File size exceeds 10MB limit";
    }
    return null;
  }, []);

  const fetchMetadata = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await fetch("/api/image/metadata", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const data = await response.json() as ImageMetadata;
        setMetadata(data);
      }
    } catch (error) {
      console.error("Failed to fetch metadata:", error);
    }
  };

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    setResult(null);
    setValidationError(null);
    setMetadata(null);
    setUploadProgress(null);
    setConversionStatus("");

    if (!selectedFile) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    const error = validateAnimatedImage(selectedFile);
    if (error) {
      setValidationError(error);
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    fetchMetadata(selectedFile);
  }, [validateAnimatedImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  }, [handleFileSelect]);

  const clearFile = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setValidationError(null);
    setMetadata(null);
    setUploadProgress(null);
    setConversionStatus("");
  }, []);

  useEffect(() => {
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, []);

  const convertMutation = useMutation({
    mutationFn: async (allowFrameReduction: boolean = false) => {
      if (!file || !mode) throw new Error("Missing file or mode");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode);
      formData.append("allowFrameReduction", allowFrameReduction.toString());

      if (mode === "custom") {
        formData.append("maxFileSize", customSettings.maxFileSize.toString());
        formData.append("minWidth", customSettings.minWidth.toString());
        formData.append("minHeight", customSettings.minHeight.toString());
        if (customSettings.maxWidth > 0) {
          formData.append("maxWidth", customSettings.maxWidth.toString());
        }
        if (customSettings.maxHeight > 0) {
          formData.append("maxHeight", customSettings.maxHeight.toString());
        }
      }

      setUploadProgress({ loaded: 0, total: file.size, percentage: 0 });
      setConversionStatus("Uploading...");

      const response = await uploadWithProgress<ConversionResult>({
        url: "/api/convert",
        formData,
        onProgress: (progress) => {
          setUploadProgress(progress);
          if (progress.percentage >= 100) {
            setConversionStatus("Processing image...");
          }
        }
      });

      return response;
    },
    onSuccess: (data) => {
      setUploadProgress(null);
      setConversionStatus("");
      if (data.requiresApproval) {
        setApprovalDialog({
          open: true,
          message: data.approvalMessage || "Frame reduction is required to meet the size limit."
        });
      } else {
        setResult(data);
      }
    },
    onError: () => {
      setUploadProgress(null);
      setConversionStatus("");
    }
  });

  const handleApprovalConfirm = () => {
    setApprovalDialog({ open: false, message: "" });
    convertMutation.mutate(true);
  };

  const handleApprovalCancel = () => {
    setApprovalDialog({ open: false, message: "" });
    setResult({
      id: "",
      originalSize: file?.size || 0,
      finalSize: 0,
      originalWidth: metadata?.width || 0,
      originalHeight: metadata?.height || 0,
      finalWidth: 0,
      finalHeight: 0,
      frameCount: metadata?.frames || 0,
      downloadUrl: "",
      previewUrl: "",
      downloadFilename: "",
      success: false,
      error: "Conversion cancelled. The file cannot be optimized without frame reduction."
    });
  };

  const canConvert = file && mode && (mode === "yalla_ludo" || (customSettings.maxFileSize > 0 && customSettings.minWidth > 0 && customSettings.minHeight > 0));

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          {!file ? (
            <div
              className="border-2 border-dashed border-border rounded-lg min-h-48 flex flex-col items-center justify-center gap-4 p-6 hover-elevate cursor-pointer transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById("gif-upload")?.click()}
              data-testid="upload-zone-converter"
            >
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-base font-medium text-foreground">
                  Drop animated image here or click to browse
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  GIF, animated WebP, or AVIF (max 10MB)
                </p>
              </div>
              <input
                id="gif-upload"
                type="file"
                accept="image/gif,image/webp,image/avif"
                className="hidden"
                onChange={handleFileInput}
                data-testid="input-gif-upload"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="w-16 h-16 rounded-md overflow-hidden bg-background flex-shrink-0">
                  {previewUrl && (
                    <img 
                      src={previewUrl} 
                      alt="Preview" 
                      className="w-full h-full object-contain"
                      data-testid="img-preview-thumbnail"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate" data-testid="text-file-name">
                    {file.name}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono" data-testid="text-file-size">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={clearFile}
                  disabled={convertMutation.isPending}
                  data-testid="button-clear-file"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              {metadata && (
                <div className="p-4 bg-muted/30 rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Original File Information</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">File Size</p>
                      <p className="font-mono font-medium" data-testid="text-original-size">
                        {formatFileSize(metadata.fileSize)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Dimensions</p>
                      <p className="font-mono font-medium" data-testid="text-original-dimensions">
                        {metadata.width} x {metadata.height} px
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Format</p>
                      <p className="font-mono font-medium" data-testid="text-original-format">
                        {metadata.format} ({metadata.frames} frames)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {validationError && (
            <div className="flex items-center gap-2 p-4 mt-4 rounded-md bg-destructive/10 text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm" data-testid="text-validation-error">{validationError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-medium mb-4">Conversion Mode</h3>
          
          <RadioGroup 
            value={mode || ""} 
            onValueChange={(value) => setMode(value as ConversionMode)}
            className="space-y-3"
          >
            <label 
              className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                mode === "yalla_ludo" ? "border-primary bg-primary/5" : "border-border hover-elevate"
              }`}
              data-testid="radio-yalla-ludo"
            >
              <RadioGroupItem value="yalla_ludo" id="yalla_ludo" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">Yalla Ludo</span>
                  <Badge variant="secondary" className="text-xs font-mono">
                    Max 2MB
                  </Badge>
                  <Badge variant="outline" className="text-xs font-mono">
                    180x180px min
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Pads small images to 180x180 minimum, always outputs GIF
                </p>
              </div>
            </label>

            <label 
              className={`flex flex-col gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                mode === "custom" ? "border-primary bg-primary/5" : "border-border hover-elevate"
              }`}
              data-testid="radio-custom"
            >
              <div className="flex items-center gap-4">
                <RadioGroupItem value="custom" id="custom" />
                <div>
                  <span className="font-medium">Custom Settings</span>
                  <p className="text-sm text-muted-foreground">
                    Define your own size and dimension limits
                  </p>
                </div>
              </div>

              {mode === "custom" && (
                <div className="space-y-4 ml-8" onClick={(e) => e.stopPropagation()}>
                  <div className="space-y-2">
                    <Label htmlFor="maxFileSize" className="text-sm font-medium">
                      Max File Size (MB) *
                    </Label>
                    <Input
                      id="maxFileSize"
                      type="number"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={customSettings.maxFileSize}
                      onChange={(e) => setCustomSettings(prev => ({
                        ...prev,
                        maxFileSize: parseFloat(e.target.value) || 0
                      }))}
                      className="font-mono text-right max-w-32"
                      data-testid="input-max-file-size"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="minWidth" className="text-sm font-medium">
                        Min Width (px) *
                      </Label>
                      <Input
                        id="minWidth"
                        type="number"
                        min={1}
                        max={2000}
                        step={1}
                        value={customSettings.minWidth}
                        onChange={(e) => setCustomSettings(prev => ({
                          ...prev,
                          minWidth: parseInt(e.target.value) || 0
                        }))}
                        className="font-mono text-right"
                        data-testid="input-min-width"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minHeight" className="text-sm font-medium">
                        Min Height (px) *
                      </Label>
                      <Input
                        id="minHeight"
                        type="number"
                        min={1}
                        max={2000}
                        step={1}
                        value={customSettings.minHeight}
                        onChange={(e) => setCustomSettings(prev => ({
                          ...prev,
                          minHeight: parseInt(e.target.value) || 0
                        }))}
                        className="font-mono text-right"
                        data-testid="input-min-height"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="maxWidth" className="text-sm font-medium">
                        Max Width (px)
                      </Label>
                      <Input
                        id="maxWidth"
                        type="number"
                        min={0}
                        max={4000}
                        step={1}
                        value={customSettings.maxWidth || ""}
                        placeholder="Original"
                        onChange={(e) => setCustomSettings(prev => ({
                          ...prev,
                          maxWidth: parseInt(e.target.value) || 0
                        }))}
                        className="font-mono text-right"
                        data-testid="input-max-width"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="maxHeight" className="text-sm font-medium">
                        Max Height (px)
                      </Label>
                      <Input
                        id="maxHeight"
                        type="number"
                        min={0}
                        max={4000}
                        step={1}
                        value={customSettings.maxHeight || ""}
                        placeholder="Original"
                        onChange={(e) => setCustomSettings(prev => ({
                          ...prev,
                          maxHeight: parseInt(e.target.value) || 0
                        }))}
                        className="font-mono text-right"
                        data-testid="input-max-height"
                      />
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    * Required fields. Leave max width/height empty to keep original dimensions (increased if needed for minimum).
                  </p>
                </div>
              )}
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Button
        className="w-full py-6 text-base font-medium"
        disabled={!canConvert || convertMutation.isPending}
        onClick={() => convertMutation.mutate(false)}
        data-testid="button-convert"
      >
        {convertMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {conversionStatus || "Converting..."}
          </>
        ) : (
          <>
            <FileImage className="w-4 h-4 mr-2" />
            Convert to GIF
          </>
        )}
      </Button>

      {convertMutation.isPending && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm font-medium">{conversionStatus || "Processing..."}</span>
                </div>
                {uploadProgress && uploadProgress.percentage < 100 && (
                  <span className="text-sm font-mono text-muted-foreground" data-testid="text-conversion-progress">
                    {formatFileSize(uploadProgress.loaded)} / {formatFileSize(uploadProgress.total)} ({uploadProgress.percentage}%)
                  </span>
                )}
              </div>
              <Progress value={uploadProgress?.percentage ?? undefined} className="h-2" />
              {uploadProgress && uploadProgress.percentage >= 100 && (
                <p className="text-xs text-muted-foreground">
                  Processing may take a moment depending on the file size and frame count...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {convertMutation.isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Conversion Failed</p>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-conversion-error">
                  {convertMutation.error?.message || "An unexpected error occurred"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !result.success && result.error && (
        <Card className="border-destructive/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Conversion Not Possible</p>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-conversion-cancelled">
                  {result.error}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.success && (
        <Card className="border-primary/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <CheckCircle className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-medium">Conversion Complete</h3>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex items-center justify-center p-4 bg-muted/50 rounded-lg">
                <img 
                  src={result.previewUrl} 
                  alt="Converted GIF" 
                  className="max-w-full max-h-64 object-contain rounded-md"
                  data-testid="img-converted-preview"
                />
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-3">
                    <p className="font-medium text-muted-foreground">Before</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size</span>
                        <span className="font-mono" data-testid="text-result-original-size">
                          {formatFileSize(result.originalSize)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dimensions</span>
                        <span className="font-mono" data-testid="text-result-original-dimensions">
                          {result.originalWidth}x{result.originalHeight}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="font-medium text-primary">After</p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size</span>
                        <span className="font-mono text-primary" data-testid="text-final-size">
                          {formatFileSize(result.finalSize)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dimensions</span>
                        <span className="font-mono text-primary" data-testid="text-final-dimensions">
                          {result.finalWidth}x{result.finalHeight}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Frames preserved</span>
                    <span className="font-mono" data-testid="text-frame-count">{result.frameCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Compression</span>
                    <span className="font-mono text-primary" data-testid="text-compression-ratio">
                      {Math.round((1 - result.finalSize / result.originalSize) * 100)}% smaller
                    </span>
                  </div>
                </div>

                <Button 
                  className="w-full mt-4" 
                  data-testid="button-download"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = result.downloadUrl;
                    link.download = result.downloadFilename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download as {result.downloadFilename}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={approvalDialog.open} onOpenChange={(open) => !open && handleApprovalCancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Frame Reduction Required
            </AlertDialogTitle>
            <AlertDialogDescription>
              {approvalDialog.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleApprovalCancel} data-testid="button-cancel-frame-reduction">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleApprovalConfirm} data-testid="button-approve-frame-reduction">
              Proceed with Frame Reduction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
