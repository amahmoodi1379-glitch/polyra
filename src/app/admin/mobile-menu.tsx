"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/i18n";
import { AccountRow, AdminNav, LanguageScope, PanelMark } from "./admin-nav";

export function MobileMenu({ language, showTestCodes, phone }: { language: string; showTestCodes: boolean; phone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("admin.menu")}>
          <Menu strokeWidth={1.75} />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="bg-surface w-[300px] gap-6 overflow-y-auto px-4 pt-[22px] pb-4">
        <SheetTitle asChild>
          <div className="flex min-h-11 items-center">
            <PanelMark />
          </div>
        </SheetTitle>
        <LanguageScope current={language} />
        <AdminNav showTestCodes={showTestCodes} onNavigate={() => setOpen(false)} />
        <AccountRow phone={phone} />
      </SheetContent>
    </Sheet>
  );
}
