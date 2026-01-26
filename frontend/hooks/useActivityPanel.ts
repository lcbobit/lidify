"use client";

import { useState, useCallback, useEffect } from "react";

const ACTIVITY_PANEL_KEY = "lidify_activity_panel_open";

// Helper to get initial state from localStorage (SSR-safe)
function getInitialOpenState(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ACTIVITY_PANEL_KEY) === "true";
}

export function useActivityPanel() {
    const [isOpen, setIsOpen] = useState(getInitialOpenState);
    const [activeTab, setActiveTab] = useState<"notifications" | "active" | "history">("notifications");
    // On client, we're immediately initialized. On server (SSR), start as false.
    // After hydration, the state will be correct since we use lazy initializers.
    const [isInitialized] = useState(() => typeof window !== "undefined");

    // Persist state to localStorage
    useEffect(() => {
        if (isInitialized && typeof window !== "undefined") {
            localStorage.setItem(ACTIVITY_PANEL_KEY, isOpen ? "true" : "false");
        }
    }, [isOpen, isInitialized]);

    const toggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const open = useCallback(() => {
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
    }, []);

    return {
        isOpen,
        activeTab,
        setActiveTab,
        toggle,
        open,
        close,
        isInitialized,
    };
}
