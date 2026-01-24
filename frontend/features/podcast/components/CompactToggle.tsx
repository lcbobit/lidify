import { Lock } from "lucide-react";

interface CompactToggleProps {
    id?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    locked?: boolean;
    variant?: 'green' | 'purple';
}

export function CompactToggle({
    id,
    checked,
    onChange,
    disabled,
    locked,
    variant = 'green'
}: CompactToggleProps) {
    const isDisabled = disabled || locked;

    const bgColor = locked
        ? 'bg-[#505050]'  // Locked state - muted
        : variant === 'purple'
            ? checked ? 'bg-purple-500' : 'bg-[#404040]'
            : checked ? 'bg-[#1DB954]' : 'bg-[#404040]';

    const ringColor = variant === 'purple'
        ? 'peer-focus:ring-purple-500/30'
        : 'peer-focus:ring-[#1DB954]/30';

    return (
        <label
            className="relative inline-flex items-center cursor-pointer gap-1"
            onClick={(e) => e.stopPropagation()}
        >
            <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                    e.stopPropagation();
                    if (!isDisabled) {
                        onChange(e.target.checked);
                    }
                }}
                disabled={isDisabled}
                className="sr-only peer"
            />
            <div className={`
                w-7 h-4 rounded-full transition-colors
                ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}
                ${bgColor}
                peer-focus:outline-none peer-focus:ring-2 ${ringColor}
                after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:bg-white after:rounded-full after:h-3 after:w-3
                after:transition-transform after:duration-200
                ${checked ? 'after:translate-x-3' : 'after:translate-x-0'}
            `} />
            {locked && (
                <Lock className="w-3 h-3 text-gray-500" />
            )}
        </label>
    );
}
