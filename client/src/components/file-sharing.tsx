import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  Upload, 
  Copy, 
  Trash2, 
  AlertCircle, 
  CheckCircle, 
  Loader2,
  X,
  Clock,
  Link2,
  FileIcon
} from "lucide-react";
import type { UploadedFile } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

export function FileSharing() {
  const [file, setFile] = useState<File | null>(null);
  const [expiryHours, setExpiryHours] = useState(24);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: uploadedFiles = [], isLoading: filesLoading } = useQuery<UploadedFile[]>({
    queryKey: ["/api/files"],
    refetchInterval: 30000,
  });

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_UPLOAD_SIZE) {
      return "File size exceeds 100MB limit";
    }
    return null;
  }, []);

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    setValidationError(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const error = validateFile(selectedFile);
    if (error) {
      setValidationError(error);
      setFile(null);
      return;
    }

    setFile(selectedFile);
  }, [validateFile]);

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
    setValidationError(null);
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("expiryHours", expiryHours.toString());

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Upload failed");
      }

      return response.json() as Promise<UploadedFile>;
    },
    onSuccess: () => {
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({
        title: "File uploaded successfully",
        description: "Your download link is ready to share",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/files/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Delete failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({
        title: "File deleted",
        description: "The file has been permanently removed",
      });
    },
  });

  const copyToClipboard = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(window.location.origin + url);
      toast({
        title: "Link copied",
        description: "Download link copied to clipboard",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please copy the link manually",
        variant: "destructive",
      });
    }
  }, [toast]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileIcon = (mimeType: string) => {
    return <FileIcon className="w-5 h-5 text-muted-foreground" />;
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
              onClick={() => document.getElementById("file-upload")?.click()}
              data-testid="upload-zone-sharing"
            >
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-base font-medium text-foreground">
                  Upload any file
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Max 100MB, expires automatically
                </p>
              </div>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                onChange={handleFileInput}
                data-testid="input-file-upload"
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="w-12 h-12 rounded-md bg-background flex items-center justify-center flex-shrink-0">
                  {getFileIcon(file.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate" data-testid="text-selected-file-name">
                    {file.name}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono" data-testid="text-selected-file-size">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={clearFile}
                  data-testid="button-clear-selected-file"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Expiry Time</Label>
                  <span className="text-sm font-mono text-muted-foreground" data-testid="text-expiry-display">
                    {expiryHours} hour{expiryHours !== 1 ? "s" : ""}
                  </span>
                </div>
                <Slider
                  value={[expiryHours]}
                  onValueChange={([value]) => setExpiryHours(value)}
                  min={1}
                  max={24}
                  step={1}
                  className="w-full"
                  data-testid="slider-expiry"
                />
                <p className="text-xs text-muted-foreground">
                  File will be automatically deleted after the expiry time
                </p>
              </div>
            </div>
          )}

          {validationError && (
            <div className="flex items-center gap-2 p-4 mt-4 rounded-md bg-destructive/10 text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm" data-testid="text-file-validation-error">{validationError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {file && (
        <Button
          className="w-full py-6 text-base font-medium"
          disabled={uploadMutation.isPending}
          onClick={() => uploadMutation.mutate()}
          data-testid="button-upload"
        >
          {uploadMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Upload & Get Link
            </>
          )}
        </Button>
      )}

      {uploadMutation.isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Upload Failed</p>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-upload-error">
                  {uploadMutation.error?.message || "An unexpected error occurred"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Your Shared Files</h3>
          <div className="space-y-3">
            {uploadedFiles.map((uploadedFile) => (
              <FileCard 
                key={uploadedFile.id} 
                file={uploadedFile} 
                onDelete={() => deleteMutation.mutate(uploadedFile.id)}
                onCopy={() => copyToClipboard(uploadedFile.downloadUrl)}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {filesLoading && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

interface FileCardProps {
  file: UploadedFile;
  onDelete: () => void;
  onCopy: () => void;
  isDeleting: boolean;
}

function FileCard({ file, onDelete, onCopy, isDeleting }: FileCardProps) {
  const [timeRemaining, setTimeRemaining] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const expiresAt = new Date(file.expiresAt);
      const now = new Date();
      const diff = expiresAt.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining("Expired");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m remaining`);
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s remaining`);
      } else {
        setTimeRemaining(`${seconds}s remaining`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [file.expiresAt]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card data-testid={`card-file-${file.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
            <FileIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground truncate" data-testid={`text-filename-${file.id}`}>
                {file.fileName}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button 
                  size="icon" 
                  variant="ghost"
                  onClick={onCopy}
                  data-testid={`button-copy-${file.id}`}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button 
                  size="icon" 
                  variant="ghost"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive"
                  data-testid={`button-delete-${file.id}`}
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="font-mono" data-testid={`text-filesize-${file.id}`}>
                {formatFileSize(file.fileSize)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span data-testid={`text-expiry-${file.id}`}>{timeRemaining}</span>
              </span>
            </div>

            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
              <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <Input
                readOnly
                value={`${window.location.origin}${file.downloadUrl}`}
                className="h-auto py-1 px-2 text-xs font-mono bg-transparent border-0 focus-visible:ring-0"
                data-testid={`input-download-link-${file.id}`}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
