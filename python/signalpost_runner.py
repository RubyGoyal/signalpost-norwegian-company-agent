"""Runs the Signalpost agent from a Python environment that has no Node installed.

The agent is TypeScript and is not changed by this: `signalpost <input-file> <out-dir>` installs
its Node dependencies once with `npm ci`, then runs the command the README gives,
`npx tsx agent/run.ts <input-file> <out-dir>`, through the Node that
`nodejs-wheel-binaries` installs from PyPI. Every argument is passed straight through, so the
agent's own flags (`--deadline-seconds`, `--state-dir`, ...) work unchanged.

Two extra commands help a reviewer check the install without a full run:

    signalpost --selftest     the offline checks (no network)
    signalpost --where        where the repository and the Node binaries are
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

__all__ = ["main", "repo_root", "run_agent"]


def repo_root() -> Path:
    """The checkout holding agent/run.ts.

    Normally the directory this module was installed from. When the package was installed into a
    virtual environment elsewhere (`pip install /path/to/checkout`), SIGNALPOST_REPO names it.
    """
    env = os.environ.get("SIGNALPOST_REPO")
    if env:
        root = Path(env).expanduser().resolve()
        if not (root / "agent" / "run.ts").is_file():
            raise SystemExit(f"SIGNALPOST_REPO is set to {root}, which has no agent/run.ts")
        return root
    here = Path(__file__).resolve()
    for folder in (here.parent.parent, *here.parents, Path.cwd()):
        if (folder / "agent" / "run.ts").is_file() and (folder / "package.json").is_file():
            return folder
    raise SystemExit(
        "Could not find the Signalpost checkout (no agent/run.ts near this module or in the "
        "current directory). Run the command from the checkout, or set SIGNALPOST_REPO to it."
    )


def _put_node_on_path() -> None:
    """Put the wheel's binaries on PATH.

    npm runs a package's install script as `sh -c "node ..."`, and tsx spawns node for the
    TypeScript loader, so both need `node` to be findable by name, not just callable from Python.
    """
    try:
        import nodejs_wheel  # type: ignore
    except ImportError:
        return
    bindir = Path(nodejs_wheel.__file__).resolve().parent / "bin"
    if not bindir.is_dir():
        return
    current = os.environ.get("PATH", "")
    if str(bindir) not in current.split(os.pathsep):
        os.environ["PATH"] = os.pathsep.join([str(bindir), current]) if current else str(bindir)


def _node_commands():
    """npm and npx, from the PyPI wheel if it is installed, otherwise from PATH."""
    _put_node_on_path()
    try:
        from nodejs_wheel import npm, npx  # type: ignore
    except ImportError:
        npm_exe, npx_exe = shutil.which("npm"), shutil.which("npx")
        if not npm_exe or not npx_exe:
            raise SystemExit(
                "No Node toolchain. Install this package (`uv pip install .`), which brings Node "
                "in from PyPI, or put Node 22.12 or later on PATH."
            )
        return (
            lambda args, cwd: subprocess.run([npm_exe, *args], cwd=cwd).returncode,
            lambda args, cwd: subprocess.run([npx_exe, *args], cwd=cwd).returncode,
        )

    def _code(value) -> int:
        # nodejs_wheel returns an exit code, or a CompletedProcess on older versions.
        return int(getattr(value, "returncode", value) or 0)

    return (
        lambda args, cwd: _code(npm(args, cwd=cwd)),
        lambda args, cwd: _code(npx(args, cwd=cwd)),
    )


def _ensure_dependencies(root: Path, npm_run) -> None:
    """`npm ci` on the first run. Later runs skip it, so a scored run is not slowed down."""
    marker = root / "node_modules" / ".signalpost-install-ok"
    if marker.is_file():
        return
    print("Installing the agent's Node dependencies (npm ci), once...", file=sys.stderr, flush=True)
    code = npm_run(["ci", "--no-audit", "--no-fund"], str(root))
    if code != 0:
        raise SystemExit(f"npm ci failed with exit code {code}")
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("installed by signalpost_runner\n", encoding="utf-8")


def run_agent(argv: list[str]) -> int:
    """Install if needed, then run the agent with these arguments."""
    root = repo_root()
    npm_run, npx_run = _node_commands()
    _ensure_dependencies(root, npm_run)
    return npx_run(["tsx", "agent/run.ts", *argv], str(root))


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] in ("--help", "-h"):
        print(__doc__.strip())
        return 0
    root = repo_root()
    if args and args[0] == "--where":
        npm_run, npx_run = _node_commands()
        print(f"repository: {root}")
        print("node:       ", end="", flush=True)
        npx_run(["node", "--version"], str(root))
        return 0
    if args and args[0] == "--selftest":
        npm_run, npx_run = _node_commands()
        _ensure_dependencies(root, npm_run)
        return npx_run(["tsx", "agent/test/selftest.ts"], str(root))
    if not args:
        print(
            "usage: signalpost <input-file> <out-dir> [agent options]\n"
            "       signalpost --selftest    run the offline checks\n"
            "       signalpost --where       show the repository and Node version",
            file=sys.stderr,
        )
        return 2
    return run_agent(args)


if __name__ == "__main__":
    raise SystemExit(main())
