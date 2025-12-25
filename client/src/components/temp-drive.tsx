import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Lock, 
  Upload, 
  Download, 
  Trash2, 
  Share2, 
  Copy, 
  LogOut, 
  Shield,
  HardDrive,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  FileIcon,
  X
} from "lucide-react";
import type { TempDriveFile, TempDriveBlockedIp, StorageStatus } from "@shared/schema";

interface TempDriveProps {
  shareToken?: string;
}

interface TempDriveStatus {
  totpSetupComplete: boolean;
  shareActive: boolean;
  shareExpiresAt: string | null;
}

type AuthState = "unauthenticated" | "totp_setup" | "otp_required" | "authenticated";
type AdminTab = "files" | "blocked-ips";

export function TempDrive({ shareToken }: TempDriveProps) {
  const { toast } = useToast();
  const [authState, setAuthState] = useState<AuthState>("unauthenticated");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpQrCode, setTotpQrCode] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>("files");
  
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("5");
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
  }, [sessionToken]);

  const { data: status } = useQuery<TempDriveStatus>({
    queryKey: ["/api/temp-drive/status"],
    refetchInterval: 30000
  });

  const { data: blockedIps = [], isLoading: blockedIpsLoading, refetch: refetchBlockedIps } = useQuery<TempDriveBlockedIp[]>({
    queryKey: ["/api/temp-drive/blocked-ips"],
    enabled: !!sessionToken && isAdmin,
    queryFn: async () => {
      const res = await fetch("/api/temp-drive/blocked-ips", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch blocked IPs");
      return res.json();
    }
  });

  const { data: storageInfo } = useQuery<StorageStatus>({
    queryKey: ["/api/temp-drive/storage"],
    enabled: !!sessionToken,
    refetchInterval: 60000,
    queryFn: async () => {
      const res = await fetch("/api/temp-drive/storage", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch storage info");
      return res.json();
    }
  });

  const { data: files = [], isLoading: filesLoading, refetch: refetchFiles } = useQuery<TempDriveFile[]>({
    queryKey: ["/api/temp-drive/files"],
    enabled: !!sessionToken,
    queryFn: async () => {
      const res = await fetch("/api/temp-drive/files", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    }
  });

  useEffect(() => {
    if (shareToken) {
      fetch(`/api/temp-drive/share/validate/${shareToken}`)
        .then(res => res.json())
        .then(data => {
          if (!data.valid) {
            toast({ title: "Share link invalid or expired", variant: "destructive" });
          }
        });
    }
  }, [shareToken, toast]);

  const loginMutation = useMutation({
    mutationFn: async (data: { password: string; otp?: string }) => {
      const res = await fetch("/api/temp-drive/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.requiresOtp) {
          return { requiresOtp: true };
        }
        throw new Error(json.message || "Login failed");
      }
      return json;
    },
    onSuccess: (data) => {
      if (data.requiresTotpSetup) {
        setTotpQrCode(data.qrCode);
        setTotpSecret(data.secret);
        setAuthState("totp_setup");
      } else if (data.requiresOtp) {
        setAuthState("otp_required");
      } else if (data.token) {
        setSessionToken(data.token);
        setIsAdmin(data.type === "admin");
        setAuthState("authenticated");
        setPassword("");
        setOtp("");
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const setupTotpMutation = useMutation({
    mutationFn: async (data: { password: string; otp: string }) => {
      const res = await fetch("/api/temp-drive/admin/setup-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "TOTP setup failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.token) {
        setSessionToken(data.token);
        setIsAdmin(true);
        setAuthState("authenticated");
        setPassword("");
        setOtp("");
        setTotpQrCode(null);
        setTotpSecret(null);
        toast({ title: "2FA setup complete" });
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const shareAccessMutation = useMutation({
    mutationFn: async (data: { token: string; password: string }) => {
      const res = await fetch(`/api/temp-drive/share/access/${data.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.password })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Access denied");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.token) {
        setSessionToken(data.token);
        setIsAdmin(false);
        setAuthState("authenticated");
        setPassword("");
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/temp-drive/admin/logout", {
        method: "POST",
        headers: getAuthHeaders()
      });
    },
    onSuccess: () => {
      setSessionToken(null);
      setIsAdmin(false);
      setAuthState("unauthenticated");
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive"] });
    }
  });

  const createShareMutation = useMutation({
    mutationFn: async (data: { password: string; expiryMinutes: number | null }) => {
      const res = await fetch("/api/temp-drive/share/create", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Failed to create share");
      return res.json();
    },
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      setGeneratedShareUrl(fullUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/status"] });
    },
    onError: () => {
      toast({ title: "Failed to create share link", variant: "destructive" });
    }
  });

  const disableShareMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/temp-drive/share/disable", {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Failed to disable share");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Share disabled" });
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/status"] });
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/temp-drive/files/upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File uploaded" });
      refetchFiles();
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/storage"] });
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const res = await fetch(`/api/temp-drive/files/${fileId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File deleted" });
      refetchFiles();
      setDeleteFileId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/storage"] });
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/temp-drive/files", {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Delete all failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "All files deleted" });
      refetchFiles();
      setDeleteAllDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/storage"] });
    }
  });

  const unblockIpMutation = useMutation({
    mutationFn: async (ip: string) => {
      const res = await fetch(`/api/temp-drive/blocked-ips/${encodeURIComponent(ip)}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Unblock failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "IP unblocked" });
      refetchBlockedIps();
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const handleLogin = () => {
    if (shareToken) {
      shareAccessMutation.mutate({ token: shareToken, password });
    } else if (authState === "otp_required") {
      loginMutation.mutate({ password, otp });
    } else {
      loginMutation.mutate({ password });
    }
  };

  const handleTotpSetup = () => {
    setupTotpMutation.mutate({ password, otp });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
      e.target.value = "";
    }
  };

  const handleDownload = async (file: TempDriveFile) => {
    const res = await fetch(`/api/temp-drive/files/download/${file.id}`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleCreateShare = () => {
    const expiryMinutes = shareExpiry === "forever" ? null : parseInt(shareExpiry);
    createShareMutation.mutate({ password: sharePassword, expiryMinutes });
  };

  const copyShareUrl = () => {
    if (generatedShareUrl) {
      navigator.clipboard.writeText(generatedShareUrl);
      toast({ title: "Share URL copied" });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (authState === "unauthenticated" || authState === "otp_required") {
    return (
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>
            {shareToken ? "Enter Share Password" : "Temp Drive Access"}
          </CardTitle>
          <CardDescription>
            {shareToken 
              ? "Enter the password to access shared files" 
              : authState === "otp_required" 
                ? "Enter your Google Authenticator code" 
                : "Enter admin password to access Temp Drive"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authState !== "otp_required" && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  data-testid="input-temp-drive-password"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          )}

          {authState === "otp_required" && (
            <div className="space-y-2">
              <Label htmlFor="otp">Google Authenticator Code</Label>
              <Input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter 6-digit code"
                data-testid="input-temp-drive-otp"
                maxLength={6}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
          )}

          <Button 
            className="w-full" 
            onClick={handleLogin}
            disabled={loginMutation.isPending || shareAccessMutation.isPending}
            data-testid="button-temp-drive-login"
          >
            {(loginMutation.isPending || shareAccessMutation.isPending) && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            {authState === "otp_required" ? "Verify" : "Access"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (authState === "totp_setup") {
    return (
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>
            Scan this QR code with Google Authenticator, then enter the code below
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {totpQrCode && (
            <div className="flex justify-center">
              <img src={totpQrCode} alt="TOTP QR Code" className="w-48 h-48" />
            </div>
          )}

          {totpSecret && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Manual entry code:</p>
              <code className="text-sm bg-muted px-2 py-1 rounded">{totpSecret}</code>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="setup-otp">Verification Code</Label>
            <Input
              id="setup-otp"
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter 6-digit code"
              data-testid="input-temp-drive-setup-otp"
              maxLength={6}
            />
          </div>

          <Button 
            className="w-full" 
            onClick={handleTotpSetup}
            disabled={setupTotpMutation.isPending || otp.length !== 6}
            data-testid="button-temp-drive-setup-totp"
          >
            {setupTotpMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Complete Setup
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Temp Drive</h2>
          <Badge variant={isAdmin ? "default" : "secondary"} className="text-xs">
            {isAdmin ? "Admin" : "Shared Access"}
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <>
              {status?.shareActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disableShareMutation.mutate()}
                  disabled={disableShareMutation.isPending}
                  data-testid="button-disable-share"
                >
                  <X className="w-4 h-4 mr-1" />
                  Disable Share
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareDialogOpen(true)}
                  data-testid="button-share-drive"
                >
                  <Share2 className="w-4 h-4 mr-1" />
                  Share Drive
                </Button>
              )}
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-1" />
            Logout
          </Button>
        </div>
      </div>

      {storageInfo && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="text-sm text-muted-foreground">Storage Usage</span>
              <span className="text-sm font-medium">
                {formatBytes(storageInfo.usedBytes)} / {formatBytes(storageInfo.totalBytes)}
              </span>
            </div>
            <Progress 
              value={storageInfo.usedPercentage} 
              className={storageInfo.warning ? "bg-destructive/20" : ""}
            />
            {storageInfo.warning && (
              <div className="flex items-center gap-2 mt-2 text-destructive text-sm">
                <AlertTriangle className="w-4 h-4" />
                Storage is 95% full. Delete files to free up space.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <div className="flex gap-2 border-b">
          <Button
            variant="ghost"
            className={`rounded-none border-b-2 ${adminTab === "files" ? "border-primary" : "border-transparent"}`}
            onClick={() => setAdminTab("files")}
            data-testid="tab-files"
          >
            <FileIcon className="w-4 h-4 mr-2" />
            Files
          </Button>
          <Button
            variant="ghost"
            className={`rounded-none border-b-2 ${adminTab === "blocked-ips" ? "border-primary" : "border-transparent"}`}
            onClick={() => setAdminTab("blocked-ips")}
            data-testid="tab-blocked-ips"
          >
            <Shield className="w-4 h-4 mr-2" />
            Blocked IPs
            {blockedIps.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs">
                {blockedIps.length}
              </Badge>
            )}
          </Button>
        </div>
      )}

      {(!isAdmin || adminTab === "files") && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild data-testid="button-upload-file">
              <label className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Upload File
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploadMutation.isPending}
                />
              </label>
            </Button>

            {isAdmin && files.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => setDeleteAllDialogOpen(true)}
                data-testid="button-delete-all"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete All
              </Button>
            )}
          </div>

          {filesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No files uploaded yet</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {files.map((file) => (
                    <div 
                      key={file.id} 
                      className="flex items-center justify-between gap-4 p-4"
                      data-testid={`file-row-${file.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileIcon className="w-5 h-5 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{file.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.fileSize)} | {formatDate(file.uploadedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(file)}
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteFileId(file.id)}
                            data-testid={`button-delete-${file.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isAdmin && adminTab === "blocked-ips" && (
        <>
          {blockedIpsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : blockedIps.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No blocked IPs</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {blockedIps.map((blocked) => (
                    <div 
                      key={blocked.ip} 
                      className="flex items-center justify-between gap-4 p-4"
                      data-testid={`blocked-ip-row-${blocked.ip}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium font-mono">{blocked.ip}</p>
                        <p className="text-xs text-muted-foreground">
                          Blocked: {formatDate(blocked.blockedAt)} | Expires: {formatDate(blocked.expiresAt)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reason: {blocked.reason === "admin_login" ? "Failed admin login" : "Failed share access"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unblockIpMutation.mutate(blocked.ip)}
                        disabled={unblockIpMutation.isPending}
                        data-testid={`button-unblock-${blocked.ip}`}
                      >
                        Unblock
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Temp Drive</DialogTitle>
            <DialogDescription>
              Create a temporary share link with password protection
            </DialogDescription>
          </DialogHeader>

          {!generatedShareUrl ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-password">Share Password</Label>
                <Input
                  id="share-password"
                  type="password"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  placeholder="Password for shared access"
                  data-testid="input-share-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="share-expiry">Expiry Time</Label>
                <Select value={shareExpiry} onValueChange={setShareExpiry}>
                  <SelectTrigger data-testid="select-share-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 minutes</SelectItem>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="1440">24 hours</SelectItem>
                    <SelectItem value="forever">Forever</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateShare}
                  disabled={!sharePassword || createShareMutation.isPending}
                  data-testid="button-create-share"
                >
                  {createShareMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Share Link
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-md">
                <p className="text-sm font-medium mb-2">Share URL:</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs flex-1 break-all">{generatedShareUrl}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={copyShareUrl}
                    data-testid="button-copy-share-url"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setShareDialogOpen(false);
                    setGeneratedShareUrl(null);
                    setSharePassword("");
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Files?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {files.length} files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAllMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-all"
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteFileId} onOpenChange={() => setDeleteFileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this file. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFileId && deleteMutation.mutate(deleteFileId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-file"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
