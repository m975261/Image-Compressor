import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, 
  Download, 
  AlertCircle, 
  CheckCircle, 
  Loader2,
  X,
  FileImage
} from "lucide-react";
import type { ConversionMode, ConversionResult } from "@shared/schema";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

export function ImageConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ConversionMode | null>(null);
  const [customSettings, setCustomSettings] = useState({
    maxFileSize: 2,
    maxWidth: 180,
    maxHeight: 180,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);

  const validateGif = useCallback((file: File): string | null => {
    if (!file.type.includes("gif")) {
      return "Please upload a GIF file only";
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      return "File size exceeds 10MB limit";
    }
    return null;
  }, []);

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    setResult(null);
    setValidationError(null);

    if (!selectedFile) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    const error = validateGif(selectedFile);
    if (error) {
      setValidationError(error);
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
  }, [validateGif]);

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
  }, []);

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!file || !mode) throw new Error("Missing file or mode");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode);

      if (mode === "custom") {
        formData.append("maxFileSize", customSettings.maxFileSize.toString());
        formData.append("maxWidth", customSettings.maxWidth.toString());
        formData.append("maxHeight", customSettings.maxHeight.toString());
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Conversion failed");
      }

      return response.json() as Promise<ConversionResult>;
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const canConvert = file && mode && (mode === "yalla_ludo" || 
    (customSettings.maxFileSize > 0 && customSettings.maxWidth > 0 && customSettings.maxHeight > 0));

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
                  Drop GIF here or click to browse
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Animated GIF only, max 10MB
                </p>
              </div>
              <input
                id="gif-upload"
                type="file"
                accept="image/gif"
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
                  data-testid="button-clear-file"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
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
                    2MB / 180x180px
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Optimized preset for Yalla Ludo avatars
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
                    Define your own size limits
                  </p>
                </div>
              </div>

              {mode === "custom" && (
                <div className="grid grid-cols-3 gap-4 ml-8">
                  <div className="space-y-2">
                    <Label htmlFor="maxFileSize" className="text-sm font-medium">
                      Max Size (MB)
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
                      className="font-mono text-right"
                      data-testid="input-max-file-size"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxWidth" className="text-sm font-medium">
                      Max Width (px)
                    </Label>
                    <Input
                      id="maxWidth"
                      type="number"
                      min={10}
                      max={2000}
                      value={customSettings.maxWidth}
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
                      min={10}
                      max={2000}
                      value={customSettings.maxHeight}
                      onChange={(e) => setCustomSettings(prev => ({
                        ...prev,
                        maxHeight: parseInt(e.target.value) || 0
                      }))}
                      className="font-mono text-right"
                      data-testid="input-max-height"
                    />
                  </div>
                </div>
              )}
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Button
        className="w-full py-6 text-base font-medium"
        disabled={!canConvert || convertMutation.isPending}
        onClick={() => convertMutation.mutate()}
        data-testid="button-convert"
      >
        {convertMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Converting...
          </>
        ) : (
          <>
            <FileImage className="w-4 h-4 mr-2" />
            Convert GIF
          </>
        )}
      </Button>

      {convertMutation.isPending && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">Processing your GIF...</span>
              </div>
              <Progress value={undefined} className="h-2" />
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
                        <span className="font-mono" data-testid="text-original-size">
                          {formatFileSize(result.originalSize)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dimensions</span>
                        <span className="font-mono" data-testid="text-original-dimensions">
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
                  asChild
                  data-testid="button-download"
                >
                  <a href={result.downloadUrl} download={result.downloadFilename}>
                    <Download className="w-4 h-4 mr-2" />
                    Download as {result.downloadFilename}
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
