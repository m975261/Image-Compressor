import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageConverter } from "@/components/image-converter";
import { FileSharing } from "@/components/file-sharing";
import { TempDrive } from "@/components/temp-drive";
import { Image, Share2, HardDrive } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState("converter");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <header className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2" data-testid="text-app-title">
            File Tools
          </h1>
          <p className="text-sm text-muted-foreground">
            Convert animated GIFs and share files securely
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-8 h-auto p-1">
            <TabsTrigger 
              value="converter" 
              className="py-4 text-base font-medium gap-2 data-[state=active]:shadow-none"
              data-testid="tab-converter"
            >
              <Image className="w-4 h-4" />
              Converter
            </TabsTrigger>
            <TabsTrigger 
              value="sharing" 
              className="py-4 text-base font-medium gap-2 data-[state=active]:shadow-none"
              data-testid="tab-sharing"
            >
              <Share2 className="w-4 h-4" />
              Sharing
            </TabsTrigger>
            <TabsTrigger 
              value="temp-drive" 
              className="py-4 text-base font-medium gap-2 data-[state=active]:shadow-none"
              data-testid="tab-temp-drive"
            >
              <HardDrive className="w-4 h-4" />
              Temp Drive
            </TabsTrigger>
          </TabsList>

          <TabsContent value="converter" className="mt-0">
            <ImageConverter />
          </TabsContent>

          <TabsContent value="sharing" className="mt-0">
            <FileSharing />
          </TabsContent>

          <TabsContent value="temp-drive" className="mt-0">
            <TempDrive />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
