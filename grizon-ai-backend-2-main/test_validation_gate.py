import os
import shutil
import json
import asyncio
from Brain.agents.builder.validation_gate import ValidationGate, ValidationError, ValidationWarning

def test_validation_gate():
    print("=== TESTING VALIDATION GATE ===")

    # Create temporary mock workspace
    test_session = "test_val_gate_session"
    ws_dir = os.path.join(os.getcwd(), "workspaces", test_session)
    fe_dir = os.path.join(ws_dir, "frontend")
    src_dir = os.path.join(fe_dir, "src")
    comp_dir = os.path.join(src_dir, "components")

    os.makedirs(comp_dir, exist_ok=True)

    # 1. Create package.json
    pkg_json = {
        "name": "test-app",
        "dependencies": {
            "react": "^18.2.0"
        }
    }
    with open(os.path.join(fe_dir, "package.json"), "w", encoding="utf-8") as f:
        json.dump(pkg_json, f, indent=2)

    # 2. Create App.jsx with approved dep (framer-motion) and unapproved dep (unknown-pkg)
    app_jsx = """
import React from 'react';
import { motion } from 'framer-motion';
import Header from './components/Header';
import Footer from './components/Footer';

export default function App() {
  const label = "Switch to dark mode"; // Text containing 'Switch' should NOT trigger v5 warning!
  return (
    <motion.div>
      <Header />
      <Footer />
    </motion.div>
  );
}
"""
    with open(os.path.join(src_dir, "App.jsx"), "w", encoding="utf-8") as f:
        f.write(app_jsx)

    # 3. Create Header.jsx
    header_jsx = """
import React from 'react';
export default function Header() {
  return <header>Header Content</header>;
}
"""
    with open(os.path.join(src_dir, "components", "Header.jsx"), "w", encoding="utf-8") as f:
        f.write(header_jsx)

    # 4. Footer.jsx missing intentionally!
    # 5. Create OrphanComponent.jsx (unused component)
    orphan_jsx = """
import React from 'react';
export default function OrphanComponent() {
  return <div>Orphan</div>;
}
"""
    with open(os.path.join(src_dir, "components", "OrphanComponent.jsx"), "w", encoding="utf-8") as f:
        f.write(orphan_jsx)

    gate = ValidationGate(llm=None, session_id=test_session)

    # Test Step 1: Dependency Check & Approved Whitelist Patching
    errors, warnings, patched = gate._check_and_patch_dependencies()
    print(f"Patched deps: {patched}")
    assert "framer-motion" in patched, "framer-motion should be auto-patched from whitelist"
    
    with open(os.path.join(fe_dir, "package.json"), "r", encoding="utf-8") as f:
        updated_pkg = json.load(f)
    assert "framer-motion" in updated_pkg["dependencies"], "package.json must contain framer-motion"
    print("[OK] Dependency check & approved whitelist patching verified!")

    # Test Step 2: Import & Structure Integrity (Footer missing -> ERROR, OrphanComponent -> WARNING)
    imp_errors, imp_warns = gate._check_imports_and_structure()
    print(f"Import errors: {[str(e) for e in imp_errors]}")
    print(f"Import warnings: {[str(w) for w in imp_warns]}")

    assert any("Footer" in e.message for e in imp_errors), "Missing Footer import should cause error"
    assert not any("Switch" in e.message for e in imp_errors), "Text 'Switch to dark mode' should NOT trigger Router v5 error"
    assert any("OrphanComponent" in w.message for w in imp_warns), "OrphanComponent should cause warning, not error"
    print("[OK] Import integrity & precise Router regex check verified!")

    # Test Step 3: Targeted Snippet Extraction
    snippet = gate._extract_targeted_snippet(os.path.join(src_dir, "App.jsx"), target_line=5, window=2)
    print("Targeted Snippet preview:\n" + snippet)
    assert "Header" in snippet, "Snippet must contain target line content"
    print("[OK] Targeted snippet extraction verified!")

    # Test Step 4: Error Fingerprinting
    test_err = ValidationError("imports", "Broken import './components/Footer'", "frontend/src/App.jsx", line=5)
    fp = test_err.fingerprint()
    assert fp.startswith("imports:frontend/src/App.jsx:5:Broken import"), "Error fingerprint format must be stage:file:line:msg"
    print(f"[OK] Error fingerprinting verified! ({fp})")

    # Cleanup mock workspace
    shutil.rmtree(ws_dir, ignore_errors=True)
    print("=== ALL VALIDATION GATE UNIT TESTS PASSED ===")

if __name__ == "__main__":
    test_validation_gate()
