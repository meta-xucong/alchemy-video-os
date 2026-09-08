set -euo pipefail
repo=/opt/alchemy-video
cd "$repo"
python3 - <<'PY'
from pathlib import Path

path = Path("packages/creative-planning/src/index.ts")
text = path.read_text()
filename_filter = '    .filter((line) => !/\\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|pdf|pptx?|docx?)$/iu.test(line))\\n'
if filename_filter not in text:
    marker_filter = '    .map((match) => normalize(match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""))\\n    .filter(Boolean);'
    if marker_filter in text:
        text = text.replace(marker_filter, marker_filter.replace('    .filter(Boolean);', filename_filter + '    .filter(Boolean);'), 1)
marker = "const buildDialogueInstruction = (value: string, preferredLines: readonly string[] = []) => {"
helper = r'''// Keep quoted speech at the source-story level. Splitting narrative events
// first can otherwise strand half of one quoted line in an unrelated segment.
const distributeDialogueLines = (lines: readonly string[], count: number) => {
  const groups = Array.from({ length: count }, () => [] as string[]);
  const clauses = lines.flatMap((line) => line
    .split(/(?<=[。！？!?；;])/u)
    .map(normalize)
    .filter(Boolean));
  if (clauses.length === 0 || count < 1) return groups;
  if (count === 1) {
    groups[0]!.push(...clauses);
    return groups;
  }
  const totalCharacters = clauses.reduce((total, clause) => total + [...clause].length, 0);
  const targetCharacters = totalCharacters / count;
  let groupIndex = 0;
  let currentCharacters = 0;
  for (let index = 0; index < clauses.length; index += 1) {
    const remainingClauses = clauses.length - index - 1;
    const remainingGroups = count - groupIndex - 1;
    if (
      groupIndex < count - 1
      && currentCharacters > 0
      && (currentCharacters >= targetCharacters || remainingClauses < remainingGroups)
    ) {
      groupIndex += 1;
      currentCharacters = 0;
    }
    groups[groupIndex]!.push(clauses[index]!);
    currentCharacters += [...clauses[index]!].length;
  }
  return groups;
};

'''
if helper not in text:
    if marker not in text:
        raise SystemExit("dialogue compiler marker not found")
    text = text.replace(marker, helper + marker, 1)
old = "    const groups = distributeEvents(events, generationSegmentCount);\n    const continuityLevel: ContinuityLevel ="
new = "    const groups = distributeEvents(events, generationSegmentCount);\n    const dialogueGroups = distributeDialogueLines(extractDialogueLines(sourceText), generationSegmentCount);\n    const continuityLevel: ContinuityLevel ="
if "const dialogueGroups = distributeDialogueLines" not in text:
    if old not in text:
        raise SystemExit("dialogue groups insertion point not found")
    text = text.replace(old, new, 1)
old = "      const dialogueLines = extractDialogueLines(group.join(\" \"));"
new = "      const dialogueLines = dialogueGroups[index]!.length > 0\n        ? dialogueGroups[index]!\n        : extractDialogueLines(group.join(\" \"));"
if old in text:
    text = text.replace(old, new, 1)
path.write_text(text)
PY
sudo -n docker-compose --env-file secrets/video.env -f infrastructure/deploy/docker-compose.video.yml build workflow-worker
sudo -n docker-compose --env-file secrets/video.env -f infrastructure/deploy/docker-compose.video.yml up -d --no-deps --force-recreate workflow-worker
sudo -n docker-compose --env-file secrets/video.env -f infrastructure/deploy/docker-compose.video.yml ps workflow-worker
