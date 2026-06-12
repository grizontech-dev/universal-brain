import React from 'react';

export default function Footer() {
    return (
        <footer className="shrink-0 py-4 px-6 text-center">
            <p className="text-[11px] text-text-faint leading-relaxed">
                By messaging Grizon, you agree to our{' '}
                <a href="#" className="text-text-faint hover:text-text-muted underline underline-offset-2 transition-colors">
                    Terms
                </a>{' '}
                and have read our{' '}
                <a href="#" className="text-text-faint hover:text-text-muted underline underline-offset-2 transition-colors">
                    Privacy Policy
                </a>.
            </p>
        </footer>
    );
}
