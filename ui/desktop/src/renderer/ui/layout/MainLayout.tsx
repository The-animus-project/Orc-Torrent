import React, { memo } from "react";

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout = memo<MainLayoutProps>(({ children }) => {
  return (
    <div className="mainLayout">
      {children}
    </div>
  );
});

MainLayout.displayName = "MainLayout";
