import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileIcon, ImageIcon, Video, FileText, AlertTriangle, Loader2 } from "lucide-react";

interface FileInfo {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  expiresAt: string;
  downloadUrl: string;
}

export default function FilePreview() {
  const params = useParams<{ fileId: string }>();
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFileInfo() {
      try {
        const response = await fetch(`/api/files/info/${params.fileId}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || "File not found");
        }
        const data = await response.json();
        setFileInfo(data);
      } catch (err: any) {
        setError(err.message || "Failed to load file");
      } finally {
        setLoading(false);
      }
    }
    fetchFileInfo();
  }, [params.fileId]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith("image/");
  const isVideo = (mimeType: string) => mimeType.startsWith("video/");
  const isAudio = (mimeType: string) => mimeType.startsWith("audio/");
  const isPDF = (mimeType: string) => mimeType === "application/pdf";

  const getFileIcon = (mimeType: string) => {
    if (isImage(mimeType)) return <ImageIcon className="w-12 h-12 text-muted-foreground" />;
    if (isVideo(mimeType)) return <Video className="w-12 h-12 text-muted-foreground" />;
    if (isPDF(mimeType)) return <FileText className="w-12 h-12 text-muted-foreground" />;
    return <FileIcon className="w-12 h-12 text-muted-foreground" />;
  };

  const downloadUrl = fileInfo?.downloadUrl || "";

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !fileInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">File Not Found</h2>
            <p className="text-sm text-muted-foreground">
              {error || "The file you're looking for doesn't exist or has expired."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2" data-testid="text-preview-filename">
              {getFileIcon(fileInfo.mimeType)}
              <span className="truncate">{fileInfo.fileName}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {isImage(fileInfo.mimeType) && (
              <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                <img 
                  src={downloadUrl}
                  alt={fileInfo.fileName}
                  className="max-w-full max-h-[60vh] object-contain rounded-md"
                  data-testid="img-file-preview"
                />
              </div>
            )}

            {isVideo(fileInfo.mimeType) && (
              <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                <video 
                  src={downloadUrl}
                  controls
                  className="max-w-full max-h-[60vh] rounded-md"
                  data-testid="video-file-preview"
                />
              </div>
            )}

            {isAudio(fileInfo.mimeType) && (
              <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                <audio 
                  src={downloadUrl}
                  controls
                  className="w-full max-w-md"
                  data-testid="audio-file-preview"
                />
              </div>
            )}

            {!isImage(fileInfo.mimeType) && !isVideo(fileInfo.mimeType) && !isAudio(fileInfo.mimeType) && (
              <div className="flex flex-col items-center justify-center bg-muted/30 rounded-lg p-8">
                {getFileIcon(fileInfo.mimeType)}
                <p className="mt-4 text-sm text-muted-foreground">
                  Preview not available for this file type
                </p>
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
              <span data-testid="text-preview-filesize">{formatFileSize(fileInfo.fileSize)}</span>
              <span data-testid="text-preview-expiry">{getTimeRemaining(fileInfo.expiresAt)}</span>
            </div>

            <Button 
              className="w-full py-6 text-base font-medium"
              onClick={() => {
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = fileInfo.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              data-testid="button-download-file"
            >
              <Download className="w-4 h-4 mr-2" />
              Download {fileInfo.fileName}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
