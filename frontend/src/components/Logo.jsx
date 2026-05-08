import logoSrc from "@/assets/logo.png";

/**
 * Logo — the official PericL mark. Use everywhere a brand badge is shown.
 *
 * Defaults to a circular crop because the source already looks great as a
 * circular sticker. Pass `square` to skip the rounding (e.g. on a hero
 * photo where the rounded source already shows).
 */
export default function Logo({ size = 36, className = "", square = false, alt = "PericL" }) {
    return (
        <img
            src={logoSrc}
            width={size}
            height={size}
            alt={alt}
            className={`${square ? "rounded-2xl" : "rounded-full"} object-cover ${className}`}
            draggable={false}
        />
    );
}
