"use client";

import { useEffect } from "react";

export default function SWRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registered:", registration.scope);
          
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  console.log("New content available, please refresh");
                }
              });
            }
          });
        })
        .catch((error) => {
          console.log("SW registration failed:", error);
        });

      // Handle messages from SW
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data.type === "DOWNLOAD_COMPLETE") {
          const { payload } = event.data;
          if (payload.success) {
            console.log(`Downloaded: ${payload.title} EP${payload.episode}`);
            // Dispatch custom event for UI
            window.dispatchEvent(new CustomEvent("offline-download-complete", { detail: payload }));
          } else {
            console.error("Download failed:", payload.error);
            window.dispatchEvent(new CustomEvent("offline-download-failed", { detail: payload }));
          }
        }
      });
    }
  }, []);

  return null;
}