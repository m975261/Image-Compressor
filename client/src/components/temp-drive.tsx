import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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
  Plus,
  Pencil,
  FolderOpen,
  ExternalLink,
  Power,
  PowerOff
} from "lucide-react";
import type { TempDriveFile, TempDriveBlockedIp, StorageStatus, TempDriveShare, TempDriveShareFile } from "@shared/schema";

interface TempDriveProps {
  shareToken?: string;
}

interface TempDriveStatus {
  totpSetupComplete: boolean;
  sharingEnabled: boolean;
  activeShareCount: number;
  totalShareCount: number;
}

interface ShareQuota {
  usedBytes: number;
  totalBytes: number;
}

interface FilesResponse {
  files: TempDriveShareFile[];
  quota: ShareQuota;
}

type AuthState = "unauthenticated" | "totp_setup" | "otp_required" | "authenticated";
type AdminTab = "files" | "shares" | "blocked-ips";

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
  const [editingShare, setEditingShare] = useState<TempDriveShare | null>(null);
  const [shareLabel, setShareLabel] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("60");
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [viewingShareFiles, setViewingShareFiles] = useState(false);
  
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [deleteShareId, setDeleteShareId] = useState<string | null>(null);

  const [shareQuota, setShareQuota] = useState<ShareQuota | null>(null);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
  }, [sessionToken]);

  const { data: status, refetch: refetchStatus } = useQuery<TempDriveStatus>({
    queryKey: ["/api/temp-drive/status"],
    refetchInterval: 30000
  });

  const { data: shares = [], isLoading: sharesLoading, refetch: refetchShares } = useQuery<TempDriveShare[]>({
    queryKey: ["/api/temp-drive/shares"],
    enabled: !!sessionToken && isAdmin,
    queryFn: async () => {
      const res = await fetch("/api/temp-drive/shares", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch shares");
      return res.json();
    }
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

  const { data: adminFiles = [], isLoading: adminFilesLoading, refetch: refetchAdminFiles } = useQuery<TempDriveFile[]>({
    queryKey: ["/api/temp-drive/files"],
    enabled: !!sessionToken && isAdmin && !viewingShareFiles,
    queryFn: async () => {
      const res = await fetch("/api/temp-drive/files", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    }
  });

  const { data: shareFilesData, isLoading: shareFilesLoading, refetch: refetchShareFiles } = useQuery<FilesResponse>({
    queryKey: ["/api/temp-drive/files", selectedShareId],
    enabled: !!sessionToken && (viewingShareFiles || !isAdmin),
    queryFn: async () => {
      const url = isAdmin && selectedShareId 
        ? `/api/temp-drive/files?shareId=${selectedShareId}`
        : "/api/temp-drive/files";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    }
  });

  useEffect(() => {
    if (shareFilesData?.quota) {
      setShareQuota(shareFilesData.quota);
    }
  }, [shareFilesData]);

  const currentFiles = viewingShareFiles || !isAdmin ? shareFilesData?.files || [] : adminFiles;
  const filesLoading = viewingShareFiles || !isAdmin ? shareFilesLoading : adminFilesLoading;

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
      setViewingShareFiles(false);
      setSelectedShareId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive"] });
    }
  });

  const createShareMutation = useMutation({
    mutationFn: async (data: { label: string; password?: string; expiryMinutes: number | null }) => {
      const res = await fetch("/api/temp-drive/shares", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Failed to create share");
      return res.json();
    },
    onSuccess: (data) => {
      const fullUrl = `${window.location.origin}/temp-drive/share/${data.token}`;
      setGeneratedShareUrl(fullUrl);
      refetchShares();
      refetchStatus();
    },
    onError: () => {
      toast({ title: "Failed to create share link", variant: "destructive" });
    }
  });

  const updateShareMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TempDriveShare> }) => {
      const res = await fetch(`/api/temp-drive/shares/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Failed to update share");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Share updated" });
      refetchShares();
      refetchStatus();
      setShareDialogOpen(false);
      setEditingShare(null);
    },
    onError: () => {
      toast({ title: "Failed to update share", variant: "destructive" });
    }
  });

  const deleteShareMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/temp-drive/shares/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Failed to delete share");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Share deleted" });
      refetchShares();
      refetchStatus();
      setDeleteShareId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete share", variant: "destructive" });
    }
  });

  const toggleGlobalSharingMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/temp-drive/global-sharing", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!res.ok) throw new Error("Failed to toggle sharing");
      return res.json();
    },
    onSuccess: (_, enabled) => {
      toast({ title: enabled ? "Sharing enabled" : "Sharing disabled" });
      refetchStatus();
    },
    onError: () => {
      toast({ title: "Failed to toggle sharing", variant: "destructive" });
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
      if (viewingShareFiles || !isAdmin) {
        refetchShareFiles();
      } else {
        refetchAdminFiles();
      }
      queryClient.invalidateQueries({ queryKey: ["/api/temp-drive/storage"] });
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const url = viewingShareFiles && selectedShareId 
        ? `/api/temp-drive/files/${fileId}?shareId=${selectedShareId}`
        : `/api/temp-drive/files/${fileId}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File deleted" });
      if (viewingShareFiles) {
        refetchShareFiles();
      } else {
        refetchAdminFiles();
      }
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
      refetchAdminFiles();
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

  const handleDownload = async (file: TempDriveFile | TempDriveShareFile) => {
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
    createShareMutation.mutate({ 
      label: shareLabel || "Untitled Share", 
      password: sharePassword || undefined, 
      expiryMinutes 
    });
  };

  const handleUpdateShare = () => {
    if (!editingShare) return;
    updateShareMutation.mutate({
      id: editingShare.id,
      data: {
        label: shareLabel,
        active: editingShare.active
      }
    });
  };

  const openCreateShareDialog = () => {
    setEditingShare(null);
    setShareLabel("");
    setSharePassword("");
    setShareExpiry("60");
    setGeneratedShareUrl(null);
    setShareDialogOpen(true);
  };

  const openEditShareDialog = (share: TempDriveShare) => {
    setEditingShare(share);
    setShareLabel(share.label);
    setSharePassword("");
    setGeneratedShareUrl(null);
    setShareDialogOpen(true);
  };

  const openShareFiles = (share: TempDriveShare) => {
    setSelectedShareId(share.id);
    setViewingShareFiles(true);
    setAdminTab("files");
  };

  const backToAdminFiles = () => {
    setViewingShareFiles(false);
    setSelectedShareId(null);
  };

  const copyShareUrl = (url?: string) => {
    const urlToCopy = url || generatedShareUrl;
    if (urlToCopy) {
      navigator.clipboard.writeText(urlToCopy);
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

  const isShareExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  };

  const getTimeRemaining = (expiresAt: string | null) => {
    if (!expiresAt) return "Never";
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
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
              ? "Enter the password to access shared files (or leave blank if none required)" 
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
                  placeholder={shareToken ? "Enter password (optional)" : "Enter password"}
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

  const selectedShare = shares.find(s => s.id === selectedShareId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          <h2 className="text-lg font-semibold">
            {viewingShareFiles && selectedShare 
              ? `Share: ${selectedShare.label}` 
              : "Temp Drive"}
          </h2>
          <Badge variant={isAdmin ? "default" : "secondary"} className="text-xs">
            {isAdmin ? "Admin" : "Shared Access"}
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {viewingShareFiles && (
            <Button
              variant="outline"
              size="sm"
              onClick={backToAdminFiles}
              data-testid="button-back-to-admin"
            >
              Back to Admin Files
            </Button>
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

      {storageInfo && isAdmin && !viewingShareFiles && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="text-sm text-muted-foreground">System Storage Usage</span>
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

      {shareQuota && (!isAdmin || viewingShareFiles) && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="text-sm text-muted-foreground">Share Storage Quota</span>
              <span className="text-sm font-medium">
                {formatBytes(shareQuota.usedBytes)} / {formatBytes(shareQuota.totalBytes)}
              </span>
            </div>
            <Progress 
              value={(shareQuota.usedBytes / shareQuota.totalBytes) * 100} 
              className={shareQuota.usedBytes > shareQuota.totalBytes * 0.9 ? "bg-destructive/20" : ""}
            />
          </CardContent>
        </Card>
      )}

      {isAdmin && !viewingShareFiles && (
        <div className="flex gap-2 border-b">
          <Button
            variant="ghost"
            className={`rounded-none border-b-2 ${adminTab === "files" ? "border-primary" : "border-transparent"}`}
            onClick={() => setAdminTab("files")}
            data-testid="tab-files"
          >
            <FileIcon className="w-4 h-4 mr-2" />
            Admin Files
          </Button>
          <Button
            variant="ghost"
            className={`rounded-none border-b-2 ${adminTab === "shares" ? "border-primary" : "border-transparent"}`}
            onClick={() => setAdminTab("shares")}
            data-testid="tab-shares"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Shares
            {shares.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {shares.length}
              </Badge>
            )}
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

      {isAdmin && adminTab === "shares" && !viewingShareFiles && (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={status?.sharingEnabled ?? true}
                  onCheckedChange={(checked) => toggleGlobalSharingMutation.mutate(checked)}
                  data-testid="switch-global-sharing"
                />
                <Label className="text-sm">
                  {status?.sharingEnabled ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <Power className="w-4 h-4" /> Sharing Enabled
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <PowerOff className="w-4 h-4" /> Sharing Disabled
                    </span>
                  )}
                </Label>
              </div>
            </div>
            <Button onClick={openCreateShareDialog} data-testid="button-create-share">
              <Plus className="w-4 h-4 mr-2" />
              New Share
            </Button>
          </div>

          {!status?.sharingEnabled && (
            <Card className="border-amber-500/50 bg-amber-500/10">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-sm font-medium">
                    Global sharing is disabled. Share links will not work until enabled.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {sharesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : shares.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Share2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No shares created yet</p>
                <p className="text-sm mt-2">Create a share to allow others to upload and download files</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {shares.map((share) => (
                    <div 
                      key={share.id} 
                      className="flex items-center justify-between gap-4 p-4"
                      data-testid={`share-row-${share.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{share.label}</p>
                          {share.passwordHash && (
                            <Badge variant="outline" className="text-xs">
                              <Lock className="w-3 h-3 mr-1" />
                              Password
                            </Badge>
                          )}
                          {isShareExpired(share.expiresAt) ? (
                            <Badge variant="destructive" className="text-xs">Expired</Badge>
                          ) : share.active ? (
                            <Badge variant="default" className="text-xs">Active</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatBytes(share.usedBytes)} / 1 GB used | 
                          Expires: {getTimeRemaining(share.expiresAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openShareFiles(share)}
                          title="View files"
                          data-testid={`button-view-share-${share.id}`}
                        >
                          <FolderOpen className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyShareUrl(`${window.location.origin}/temp-drive/share/${share.token}`)}
                          title="Copy link"
                          data-testid={`button-copy-share-${share.id}`}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditShareDialog(share)}
                          title="Edit"
                          data-testid={`button-edit-share-${share.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteShareId(share.id)}
                          title="Delete"
                          data-testid={`button-delete-share-${share.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {((!isAdmin) || adminTab === "files" || viewingShareFiles) && (
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

            {isAdmin && !viewingShareFiles && adminFiles.length > 0 && (
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
          ) : currentFiles.length === 0 ? (
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
                  {currentFiles.map((file) => (
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

      {isAdmin && adminTab === "blocked-ips" && !viewingShareFiles && (
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

      <Dialog open={shareDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setShareDialogOpen(false);
          setEditingShare(null);
          setGeneratedShareUrl(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingShare ? "Edit Share" : "Create New Share"}</DialogTitle>
            <DialogDescription>
              {editingShare 
                ? "Update share settings" 
                : "Create a new share with optional password protection"}
            </DialogDescription>
          </DialogHeader>

          {!generatedShareUrl ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-label">Share Label</Label>
                <Input
                  id="share-label"
                  type="text"
                  value={shareLabel}
                  onChange={(e) => setShareLabel(e.target.value)}
                  placeholder="e.g., Project Files, Team Uploads"
                  data-testid="input-share-label"
                />
              </div>

              {!editingShare && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="share-password">Password (Optional)</Label>
                    <Input
                      id="share-password"
                      type="password"
                      value={sharePassword}
                      onChange={(e) => setSharePassword(e.target.value)}
                      placeholder="Leave blank for no password"
                      data-testid="input-share-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      If set, users will need this password to access the share
                    </p>
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
                        <SelectItem value="360">6 hours</SelectItem>
                        <SelectItem value="720">12 hours</SelectItem>
                        <SelectItem value="1440">24 hours</SelectItem>
                        <SelectItem value="forever">Never (no expiry)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {editingShare && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingShare.active}
                    onCheckedChange={(checked) => setEditingShare({ ...editingShare, active: checked })}
                    data-testid="switch-share-active"
                  />
                  <Label>Share Active</Label>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={editingShare ? handleUpdateShare : handleCreateShare}
                  disabled={createShareMutation.isPending || updateShareMutation.isPending}
                  data-testid="button-save-share"
                >
                  {(createShareMutation.isPending || updateShareMutation.isPending) && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {editingShare ? "Save Changes" : "Create Share"}
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
                    onClick={() => copyShareUrl()}
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
                    setShareLabel("");
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
              This will permanently delete all {adminFiles.length} files. This action cannot be undone.
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

      <AlertDialog open={!!deleteShareId} onOpenChange={() => setDeleteShareId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Share?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this share and all its files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteShareId && deleteShareMutation.mutate(deleteShareId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-share"
            >
              Delete Share
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
