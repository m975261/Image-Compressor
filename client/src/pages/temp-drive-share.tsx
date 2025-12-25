import { useParams } from "wouter";
import { TempDrive } from "@/components/temp-drive";

export default function TempDriveShare() {
  const params = useParams<{ token: string }>();
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <header className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2" data-testid="text-share-title">
            Shared Temp Drive
          </h1>
          <p className="text-sm text-muted-foreground">
            Access shared files with the password provided by the sender
          </p>
        </header>

        <TempDrive shareToken={params.token} />
      </div>
    </div>
  );
}
