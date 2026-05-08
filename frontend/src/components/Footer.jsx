export default function Footer({ className = "" }) {
    return (
        <footer className={`text-center text-[11px] text-muted-foreground py-4 ${className}`} data-testid="app-footer">
            © {new Date().getFullYear()} Giridhar Alwar · PericL · A Private Behavioral OS
        </footer>
    );
}
