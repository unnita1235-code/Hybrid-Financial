#!/usr/bin/env bash
#
# git-merge-all-branches-to-main.sh
#
# Rebases every local branch (except main and backup-*) onto main, merges into main,
# deletes the local branch, then optionally force-pushes to origin.
#
# Repository: unnita1235-code/Hybrid-Financial
# Remote:     origin (https://github.com/unnita1235-code/Hybrid-Financial)
#
# Usage:
#   ./scripts/git-merge-all-branches-to-main.sh              # interactive
#   ./scripts/git-merge-all-branches-to-main.sh --dry-run      # preview only
#   ./scripts/git-merge-all-branches-to-main.sh --rollback     # restore from last backup
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
readonly REPO_SLUG="unnita1235-code/Hybrid-Financial"
readonly MAIN_BRANCH="main"
readonly REMOTE_NAME="origin"
readonly BACKUP_PREFIX="backup"
readonly ROLLBACK_STATE_FILE=".git-merge-all-branches-rollback"
readonly DATE_STAMP="$(date +%Y%m%d-%H%M%S)"
readonly BACKUP_BRANCH="${BACKUP_PREFIX}-${DATE_STAMP}"

DRY_RUN=false
DO_ROLLBACK=false
SKIP_FETCH=false
INCLUDE_REMOTE_TRACKING=false
FORCE_PUSH=false
declare -a EXCLUDE_BRANCHES=()

# Branches successfully merged (name -> tip commit before delete)
declare -a MERGED_BRANCHES=()
declare -a MERGED_COMMITS=()
declare -a FAILED_BRANCHES=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

confirm() {
  local prompt="$1"
  if [[ "${AUTO_YES:-}" == "1" ]]; then
    return 0
  fi
  printf '%s [y/N]: ' "$prompt"
  read -r reply
  [[ "${reply,,}" == "y" || "${reply,,}" == "yes" ]]
}

run_cmd() {
  if [[ "$DRY_RUN" == true ]]; then
    log "[dry-run] $*"
    return 0
  fi
  "$@"
}

save_rollback_state() {
  local backup_branch="$1"
  local main_sha
  main_sha="$(git rev-parse "$MAIN_BRANCH")"
  if [[ "$DRY_RUN" == true ]]; then
    log "[dry-run] Would write rollback state: backup=$backup_branch main=$main_sha"
    return 0
  fi
  cat > "$ROLLBACK_STATE_FILE" <<EOF
# Created by git-merge-all-branches-to-main.sh on $(date -Iseconds)
BACKUP_BRANCH=${backup_branch}
MAIN_SHA_BEFORE=${main_sha}
REMOTE=${REMOTE_NAME}
MAIN_BRANCH=${MAIN_BRANCH}
EOF
  log "Rollback state saved to ${ROLLBACK_STATE_FILE}"
}

perform_rollback() {
  if [[ ! -f "$ROLLBACK_STATE_FILE" ]]; then
    die "No rollback state found (${ROLLBACK_STATE_FILE}). Run the merge script first."
  fi
  # shellcheck source=/dev/null
  source "$ROLLBACK_STATE_FILE"

  log "Rollback will reset ${MAIN_BRANCH} to backup branch: ${BACKUP_BRANCH}"
  log "Previous main SHA (before merge run): ${MAIN_SHA_BEFORE:-unknown}"

  if ! git show-ref --verify --quiet "refs/heads/${BACKUP_BRANCH}"; then
    die "Backup branch '${BACKUP_BRANCH}' not found locally. Cannot rollback."
  fi

  git fetch "$REMOTE_NAME" --prune || warn "fetch failed; continuing with local refs only"

  if ! confirm "Reset local ${MAIN_BRANCH} to ${BACKUP_BRANCH}?"; then
    log "Rollback aborted."
    exit 0
  fi

  run_cmd git checkout "$MAIN_BRANCH"
  run_cmd git reset --hard "$BACKUP_BRANCH"
  log "Local ${MAIN_BRANCH} reset to ${BACKUP_BRANCH}"

  if confirm "Force-push ${MAIN_BRANCH} to ${REMOTE_NAME} to restore remote? (destructive)"; then
    run_cmd git push "$REMOTE_NAME" "$MAIN_BRANCH" --force-with-lease
    log "Remote ${MAIN_BRANCH} updated."
  else
    warn "Remote not updated. Run manually: git push ${REMOTE_NAME} ${MAIN_BRANCH} --force-with-lease"
  fi

  log "Rollback complete."
  exit 0
}

verify_repo() {
  if ! git rev-parse --git-dir &>/dev/null; then
    die "Not inside a git repository."
  fi

  local remote_url
  remote_url="$(git remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
  if [[ -z "$remote_url" ]]; then
    die "Remote '${REMOTE_NAME}' not configured."
  fi
  if [[ "$remote_url" != *"Hybrid-Financial"* && "$remote_url" != *"${REPO_SLUG}"* ]]; then
    warn "Remote URL does not match expected repo (${REPO_SLUG}): ${remote_url}"
    if ! confirm "Continue anyway?"; then
      exit 1
    fi
  fi

  if ! git show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}"; then
    die "Branch '${MAIN_BRANCH}' does not exist locally."
  fi
}

ensure_clean_or_stash() {
  if git diff-index --quiet HEAD -- 2>/dev/null && [[ -z "$(git status --porcelain)" ]]; then
    return 0
  fi
  warn "Working tree is not clean."
  git status --short
  if confirm "Stash all changes and continue?"; then
    run_cmd git stash push -u -m "git-merge-all-branches-to-main ${DATE_STAMP}"
    log "Changes stashed."
  else
    die "Aborting due to dirty working tree."
  fi
}

is_backup_branch() {
  [[ "$1" == "${BACKUP_PREFIX}-"* ]]
}

should_exclude_branch() {
  local b="$1"
  local pat
  for pat in "${EXCLUDE_BRANCHES[@]}"; do
    [[ "$b" == $pat ]] && return 0
  done
  return 1
}

list_branches_to_process() {
  local -a branches=()
  while IFS= read -r b; do
    [[ "$b" == "$MAIN_BRANCH" ]] && continue
    is_backup_branch "$b" && continue
    should_exclude_branch "$b" && continue
    branches+=("$b")
  done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

  if [[ "$INCLUDE_REMOTE_TRACKING" == true ]]; then
    while IFS= read -r rb; do
      [[ "$rb" == "${REMOTE_NAME}/HEAD" ]] && continue
      local short="${rb#${REMOTE_NAME}/}"
      [[ "$short" == "$MAIN_BRANCH" ]] && continue
      is_backup_branch "$short" && continue
      if ! git show-ref --verify --quiet "refs/heads/${short}" 2>/dev/null; then
        log "Creating local tracking branch for ${REMOTE_NAME}/${short}"
        if [[ "$DRY_RUN" == true ]]; then
          log "[dry-run] git branch --track ${short} ${REMOTE_NAME}/${short}"
        else
          git branch --track "$short" "${REMOTE_NAME}/${short}" 2>/dev/null || \
            git branch "$short" "${REMOTE_NAME}/${short}"
        fi
        branches+=("$short")
      fi
    done < <(git for-each-ref --format='%(refname:short)' "refs/remotes/${REMOTE_NAME}")
  fi

  # Deduplicate
  printf '%s\n' "${branches[@]}" | sort -u
}

print_commits_not_on_main() {
  log "=== Branches and commits not on ${MAIN_BRANCH} ==="
  local any=false
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    local commits
    commits="$(git log "${MAIN_BRANCH}..${branch}" --oneline 2>/dev/null || true)"
    if [[ -n "$commits" ]]; then
      any=true
      printf '\n--- %s (%s commits ahead of %s) ---\n' \
        "$branch" "$(git rev-list --count "${MAIN_BRANCH}..${branch}" 2>/dev/null || echo 0)" "$MAIN_BRANCH"
      echo "$commits"
    else
      printf '\n--- %s (no unique commits; may be behind or equal to %s) ---\n' "$branch" "$MAIN_BRANCH"
      git log "${branch}..${MAIN_BRANCH}" --oneline -3 2>/dev/null | sed 's/^/  behind: /' || true
    fi
  done < <(list_branches_to_process)

  if [[ "$any" == false ]]; then
    log "No branches with unique commits ahead of ${MAIN_BRANCH} (or no branches to process)."
  fi
  printf '\n'
}

create_backup_branch() {
  log "Creating backup branch: ${BACKUP_BRANCH} (snapshot of current HEAD)"
  run_cmd git branch "$BACKUP_BRANCH" HEAD
  save_rollback_state "$BACKUP_BRANCH"
  log "Backup branch created. To rollback later: $0 --rollback"
}

rebase_and_merge_branch() {
  local branch="$1"
  log "Processing branch: ${branch}"

  run_cmd git checkout "$MAIN_BRANCH"
  run_cmd git pull "$REMOTE_NAME" "$MAIN_BRANCH" || warn "Could not pull ${MAIN_BRANCH}; using local copy"

  local tip_before
  tip_before="$(git rev-parse "$branch")"
  MERGED_COMMITS+=("$tip_before")

  # Rebase branch onto main
  run_cmd git checkout "$branch"
  if ! run_cmd git rebase "$MAIN_BRANCH"; then
    warn "Rebase failed for ${branch}."
    if [[ "$DRY_RUN" == false ]]; then
      git rebase --abort 2>/dev/null || true
      run_cmd git checkout "$MAIN_BRANCH"
    fi
    FAILED_BRANCHES+=("$branch")
    return 1
  fi

  # Merge into main (fast-forward or merge commit)
  run_cmd git checkout "$MAIN_BRANCH"
  if ! run_cmd git merge "$branch" --no-edit -m "Merge branch '${branch}' into ${MAIN_BRANCH} via git-merge-all-branches-to-main.sh"; then
    warn "Merge failed for ${branch}."
    if [[ "$DRY_RUN" == false ]]; then
      git merge --abort 2>/dev/null || true
    fi
    FAILED_BRANCHES+=("$branch")
    return 1
  fi

  MERGED_BRANCHES+=("$branch")

  # Delete local branch
  if confirm "Delete local branch '${branch}'?"; then
    run_cmd git branch -d "$branch" 2>/dev/null || run_cmd git branch -D "$branch"
    log "Deleted local branch: ${branch}"
  else
    warn "Kept local branch: ${branch}"
  fi

  return 0
}

validate_all_commits_on_main() {
  log "=== Validating all former branch tips are reachable from ${MAIN_BRANCH} ==="
  local failed=false
  local i=0
  for sha in "${MERGED_COMMITS[@]}"; do
    if git merge-base --is-ancestor "$sha" "$MAIN_BRANCH" 2>/dev/null; then
      log "OK: ${sha:0:12} is ancestor of ${MAIN_BRANCH}"
    else
      warn "FAIL: ${sha:0:12} is NOT reachable from ${MAIN_BRANCH}"
      failed=true
    fi
    ((i++)) || true
  done

  # Also verify listed branches' unique commits
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    if git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
      local orphan
      orphan="$(git log "${MAIN_BRANCH}..${branch}" --oneline 2>/dev/null || true)"
      if [[ -n "$orphan" ]]; then
        warn "Branch ${branch} still has commits not on ${MAIN_BRANCH}:"
        echo "$orphan"
        failed=true
      fi
    fi
  done < <(list_branches_to_process)

  if [[ "$failed" == true ]]; then
    die "Validation failed. Consider: $0 --rollback"
  fi
  log "Validation passed."
}

print_summary() {
  printf '\n'
  log "========== SUMMARY =========="
  log "Backup branch:     ${BACKUP_BRANCH}"
  log "Rollback command:  $0 --rollback"
  log "Rollback state:    ${ROLLBACK_STATE_FILE}"
  printf '\n'

  if ((${#MERGED_BRANCHES[@]} > 0)); then
    log "Successfully merged branches (${#MERGED_BRANCHES[@]}):"
    local i=0
    for b in "${MERGED_BRANCHES[@]}"; do
      printf '  - %-40s (tip was %s)\n' "$b" "${MERGED_COMMITS[$i]:0:12}"
      ((i++)) || true
    done
  else
    log "No branches were merged."
  fi

  if ((${#FAILED_BRANCHES[@]} > 0)); then
    printf '\n'
    warn "Failed branches (${#FAILED_BRANCHES[@]}):"
    printf '  - %s\n' "${FAILED_BRANCHES[@]}"
  fi

  log "Current ${MAIN_BRANCH} tip: $(git rev-parse --short ${MAIN_BRANCH} 2>/dev/null || echo unknown)"
  printf '\n'
}

force_push_with_confirmation() {
  if [[ "$FORCE_PUSH" != true ]]; then
    if ! confirm "Force-push ${MAIN_BRANCH} and deleted branch refs to ${REMOTE_NAME}? (--force-with-lease)"; then
      warn "Skipped push. Local ${MAIN_BRANCH} has merges; remote unchanged."
      warn "Push manually when ready: git push ${REMOTE_NAME} ${MAIN_BRANCH} --force-with-lease"
      return 0
    fi
    FORCE_PUSH=true
  fi

  log "Pushing ${MAIN_BRANCH} to ${REMOTE_NAME} (--force-with-lease)..."
  run_cmd git push "$REMOTE_NAME" "$MAIN_BRANCH" --force-with-lease

  # Delete remote branches that were merged locally
  for b in "${MERGED_BRANCHES[@]}"; do
    if git ls-remote --exit-code --heads "$REMOTE_NAME" "$b" &>/dev/null; then
      if confirm "Delete remote branch ${REMOTE_NAME}/${b}?"; then
        run_cmd git push "$REMOTE_NAME" --delete "$b" || warn "Could not delete remote ${b}"
      fi
    fi
  done

  # Push backup branch to remote for off-machine rollback
  if confirm "Push backup branch ${BACKUP_BRANCH} to ${REMOTE_NAME} for safekeeping?"; then
    run_cmd git push "$REMOTE_NAME" "$BACKUP_BRANCH" || warn "Could not push backup branch"
  fi

  log "Push complete."
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Consolidate all local branches into ${MAIN_BRANCH} for ${REPO_SLUG}.

Options:
  --dry-run              Print actions without changing refs
  --rollback             Restore ${MAIN_BRANCH} from last backup (see ${ROLLBACK_STATE_FILE})
  --yes                  Auto-confirm prompts (AUTO_YES=1); still confirms force-push unless --force-push
  --force-push           Skip force-push confirmation (still uses --force-with-lease)
  --skip-fetch           Do not fetch from ${REMOTE_NAME} before starting
  --include-remote       Create local branches for remote-only branches and process them
  --exclude-branch PAT   Skip branch (glob, repeatable; e.g. 'cursor/*')
  -h, --help             Show this help

Safety:
  - Creates ${BACKUP_PREFIX}-<timestamp> at current HEAD before any merges
  - Writes ${ROLLBACK_STATE_FILE} for --rollback
  - Uses --force-with-lease (not bare --force) when pushing
  - Aborts on dirty tree unless you approve stash

Examples:
  $(basename "$0") --dry-run
  $(basename "$0")
  $(basename "$0") --rollback
EOF
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)            DRY_RUN=true ;;
    --rollback)           DO_ROLLBACK=true ;;
    --yes)                export AUTO_YES=1 ;;
    --force-push)         FORCE_PUSH=true ;;
    --skip-fetch)         SKIP_FETCH=true ;;
    --include-remote)     INCLUDE_REMOTE_TRACKING=true ;;
    --exclude-branch)     EXCLUDE_BRANCHES+=("$2"); shift ;;
    -h|--help)            usage; exit 0 ;;
    *)                    die "Unknown option: $1 (use --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
cd "$(git rev-parse --show-toplevel)"
verify_repo

if [[ "$DO_ROLLBACK" == true ]]; then
  perform_rollback
fi

log "Repository: ${REPO_SLUG}"
log "Main branch: ${MAIN_BRANCH}"
[[ "$DRY_RUN" == true ]] && warn "DRY RUN — no refs will be modified"

ensure_clean_or_stash

if [[ "$SKIP_FETCH" != true ]]; then
  log "Fetching from ${REMOTE_NAME}..."
  run_cmd git fetch "$REMOTE_NAME" --prune
fi

run_cmd git checkout "$MAIN_BRANCH"

if ! confirm "Create backup branch '${BACKUP_BRANCH}' and proceed with branch consolidation?"; then
  log "Aborted by user."
  exit 0
fi

create_backup_branch
print_commits_not_on_main

mapfile -t BRANCHES < <(list_branches_to_process)
if ((${#BRANCHES[@]} == 0)); then
  log "No branches to merge (excluding ${MAIN_BRANCH} and ${BACKUP_PREFIX}-*)."
else
  log "Branches to process: ${BRANCHES[*]}"
  if ! confirm "Rebase and merge ${#BRANCHES[@]} branch(es) into ${MAIN_BRANCH}?"; then
    log "Aborted before merging."
    exit 0
  fi

  for branch in "${BRANCHES[@]}"; do
    rebase_and_merge_branch "$branch" || true
  done
fi

print_summary

if ((${#MERGED_COMMITS[@]} > 0)); then
  if [[ "$DRY_RUN" == true ]]; then
    log "[dry-run] Skipping commit validation (no refs were changed)."
  else
    validate_all_commits_on_main
  fi
fi

force_push_with_confirmation

log "Done."
