import { useMemo } from 'react'
import {
  isDelete,
  isInsert,
  isNormal,
  Decoration,
  Diff,
  Hunk,
  markEdits,
  parseDiff as parseGitDiff,
  tokenize,
  type ChangeData,
  type DiffType,
  type HunkData
} from 'react-diff-view'

interface PerforceDiffViewProps {
  diffText: string
  fallbackPath?: string
  fallbackAction?: string
  showFileHeaders?: boolean
  ignoreFormattingNoise?: boolean
}

interface ParsedDiffFile {
  key: string
  displayPath: string
  shortName: string
  action?: string
  revision?: number
  diffType: DiffType
  hunks: HunkData[]
}

interface RawDiffSection {
  path: string
  action?: string
  revision?: number
  body: string
}

const TOKENIZE_LINE_LIMIT = 1200
const ADD_ACTIONS = new Set(['add', 'move/add', 'import'])
const DELETE_ACTIONS = new Set(['delete', 'move/delete'])

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizePathForGit(path: string): string {
  const slashPath = path.replace(/\\/g, '/')
  const withoutLeadingSlashes = slashPath.replace(/^\/+/, '')
  return withoutLeadingSlashes || slashPath || 'file'
}

function parseSectionHeader(line: string): Omit<RawDiffSection, 'body'> | null {
  const match = line.match(/^====\s+(.+?)(?:#(\d+))?(?:\s+\(([^)]+)\))?\s+====$/)
  if (!match) {
    return null
  }

  return {
    path: match[1],
    revision: match[2] ? parseInt(match[2], 10) : undefined,
    action: match[3]
  }
}

function splitPerforceDiffSections(
  diffText: string,
  fallbackPath?: string,
  fallbackAction?: string
): RawDiffSection[] {
  const normalized = normalizeLineEndings(diffText).replace(/\n+$/, '')
  if (!normalized.trim()) {
    return []
  }

  const lines = normalized.split('\n')
  const sections: RawDiffSection[] = []
  let currentHeader: Omit<RawDiffSection, 'body'> | null = null
  let currentLines: string[] = []

  const flush = () => {
    if (!currentHeader && currentLines.length === 0) {
      return
    }

    const path = currentHeader?.path || fallbackPath || 'Current file'
    const body = currentLines.join('\n').replace(/\n+$/, '')
    sections.push({
      path,
      action: currentHeader?.action || fallbackAction,
      revision: currentHeader?.revision,
      body
    })

    currentHeader = null
    currentLines = []
  }

  for (const line of lines) {
    if (line.trim() === 'Differences ...') {
      continue
    }

    const header = parseSectionHeader(line)
    if (header) {
      flush()
      currentHeader = header
      continue
    }

    currentLines.push(line)
  }

  flush()

  return sections.filter((section) => section.body || section.path)
}

function stripGitPreamble(body: string): string {
  const lines = normalizeLineEndings(body).split('\n')
  const filtered = lines.filter((line) => {
    return !(
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    )
  })

  const firstHunkIndex = filtered.findIndex((line) => line.startsWith('@@'))
  const relevantLines = firstHunkIndex >= 0 ? filtered.slice(firstHunkIndex) : filtered
  return relevantLines.join('\n').replace(/^\n+|\n+$/g, '')
}

function inferDiffType(action: string | undefined, body: string): DiffType {
  const normalizedAction = action?.toLowerCase()
  if (normalizedAction && ADD_ACTIONS.has(normalizedAction)) {
    return 'add'
  }
  if (normalizedAction && DELETE_ACTIONS.has(normalizedAction)) {
    return 'delete'
  }
  if (/^@@ -0(?:,0)? \+\d+(?:,\d+)? @@/m.test(body)) {
    return 'add'
  }
  if (/^@@ -\d+(?:,\d+)? \+0(?:,0)? @@/m.test(body)) {
    return 'delete'
  }
  return 'modify'
}

function buildGitDiffText(path: string, diffType: DiffType, rawBody: string): string {
  const gitPath = normalizePathForGit(path)
  const oldPath = diffType === 'add' ? '/dev/null' : `a/${gitPath}`
  const newPath = diffType === 'delete' ? '/dev/null' : `b/${gitPath}`

  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    rawBody
  ].filter(Boolean).join('\n')
}

function normalizeFormattingNoiseContent(content: string): string {
  const expandedTabs = content.replace(/\t/g, '    ')
  const withoutTrailingWhitespace = expandedTabs.replace(/[ \t]+$/g, '')
  if (/^[ \t]*$/.test(withoutTrailingWhitespace)) {
    return ''
  }
  return withoutTrailingWhitespace.replace(/^[ \t]+/g, ' ')
}

function computeLcsPairs(left: string[], right: string[]): Array<[number, number]> {
  if (left.length === 0 || right.length === 0) {
    return []
  }

  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      if (left[i] === right[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j])
      i++
      j++
      continue
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }

  return pairs
}

function createNormalChange(deleteChange: ChangeData, insertChange: ChangeData): ChangeData {
  if (!isDelete(deleteChange) || !isInsert(insertChange)) {
    return insertChange
  }

  return {
    type: 'normal',
    isNormal: true,
    oldLineNumber: deleteChange.lineNumber,
    newLineNumber: insertChange.lineNumber,
    content: insertChange.content
  } as ChangeData
}

function collapseFormattingNoiseBlock(changes: ChangeData[]): ChangeData[] {
  const deletes = changes.filter(isDelete)
  const inserts = changes.filter(isInsert)

  if (deletes.length === 0 || inserts.length === 0) {
    return changes
  }

  const normalizedDeletes = deletes.map((change) => normalizeFormattingNoiseContent(change.content))
  const normalizedInserts = inserts.map((change) => normalizeFormattingNoiseContent(change.content))
  const matchedPairs = computeLcsPairs(normalizedDeletes, normalizedInserts)

  if (matchedPairs.length === 0) {
    return changes
  }

  const output: ChangeData[] = []
  let deleteIndex = 0
  let insertIndex = 0

  for (const [matchedDeleteIndex, matchedInsertIndex] of matchedPairs) {
    while (deleteIndex < matchedDeleteIndex) {
      output.push(deletes[deleteIndex])
      deleteIndex++
    }

    while (insertIndex < matchedInsertIndex) {
      output.push(inserts[insertIndex])
      insertIndex++
    }

    output.push(createNormalChange(deletes[deleteIndex], inserts[insertIndex]))
    deleteIndex++
    insertIndex++
  }

  while (deleteIndex < deletes.length) {
    output.push(deletes[deleteIndex])
    deleteIndex++
  }

  while (insertIndex < inserts.length) {
    output.push(inserts[insertIndex])
    insertIndex++
  }

  return output
}

function collapseFormattingNoiseInHunk(hunk: HunkData): HunkData | null {
  const changes: ChangeData[] = []
  let pendingChanges: ChangeData[] = []

  const flushPendingChanges = () => {
    if (pendingChanges.length === 0) {
      return
    }

    changes.push(...collapseFormattingNoiseBlock(pendingChanges))
    pendingChanges = []
  }

  for (const change of hunk.changes) {
    if (isNormal(change)) {
      flushPendingChanges()
      changes.push(change)
      continue
    }

    pendingChanges.push(change)
  }

  flushPendingChanges()

  if (!changes.some((change) => !isNormal(change))) {
    return null
  }

  return {
    ...hunk,
    changes
  }
}

function applyFormattingNoiseFilter(file: ParsedDiffFile): ParsedDiffFile | null {
  const hunks = file.hunks
    .map((hunk) => collapseFormattingNoiseInHunk(hunk))
    .filter((hunk): hunk is HunkData => hunk !== null)

  if (hunks.length === 0) {
    return null
  }

  return {
    ...file,
    hunks
  }
}

function parsePerforceDiffFiles(
  diffText: string,
  fallbackPath?: string,
  fallbackAction?: string
): ParsedDiffFile[] {
  return splitPerforceDiffSections(diffText, fallbackPath, fallbackAction)
    .reduce<ParsedDiffFile[]>((files, section) => {
      const rawBody = stripGitPreamble(section.body)
      if (!rawBody.trim()) {
        return files
      }

      const diffType = inferDiffType(section.action, rawBody)
      const gitDiff = buildGitDiffText(section.path, diffType, rawBody)

      try {
        const [parsedFile] = parseGitDiff(gitDiff)
        if (!parsedFile || parsedFile.hunks.length === 0) {
          return files
        }

        files.push({
          key: `${section.path}@@${section.revision ?? 'head'}@@${section.action ?? 'modify'}`,
          displayPath: section.path,
          shortName: section.path.split(/[/\\]/).pop() || section.path,
          action: section.action,
          revision: section.revision,
          diffType,
          hunks: parsedFile.hunks
        })
      } catch {
        return files
      }

      return files
    }, [])
}

function formatActionLabel(action: string | undefined): string | null {
  if (!action) {
    return null
  }

  return action
    .split('/')
    .map((segment) => segment.toUpperCase())
    .join(' / ')
}

function getActionBadgeClass(action: string | undefined): string {
  const normalizedAction = action?.toLowerCase()
  if (!normalizedAction) {
    return 'perforce-diff-file__badge perforce-diff-file__badge--neutral'
  }
  if (ADD_ACTIONS.has(normalizedAction)) {
    return 'perforce-diff-file__badge perforce-diff-file__badge--add'
  }
  if (DELETE_ACTIONS.has(normalizedAction)) {
    return 'perforce-diff-file__badge perforce-diff-file__badge--delete'
  }
  if (normalizedAction === 'edit') {
    return 'perforce-diff-file__badge perforce-diff-file__badge--edit'
  }
  if (normalizedAction === 'branch' || normalizedAction === 'integrate') {
    return 'perforce-diff-file__badge perforce-diff-file__badge--branch'
  }
  return 'perforce-diff-file__badge perforce-diff-file__badge--neutral'
}

function DiffFileCard({ file, showHeader }: { file: ParsedDiffFile; showHeader: boolean }) {
  const totalChanges = useMemo(
    () => file.hunks.reduce((count, hunk) => count + hunk.changes.length, 0),
    [file.hunks]
  )

  const tokens = useMemo(() => {
    if (totalChanges > TOKENIZE_LINE_LIMIT) {
      return null
    }
    return tokenize(file.hunks, {
      enhancers: [markEdits(file.hunks, { type: 'line' })]
    })
  }, [file.hunks, totalChanges])

  const actionLabel = formatActionLabel(file.action)

  return (
    <section className={`perforce-diff-file${showHeader ? '' : ' perforce-diff-file--headerless'}`}>
      {showHeader && (
        <header className="perforce-diff-file__header">
          <div className="perforce-diff-file__titleBlock">
            <div className="perforce-diff-file__title">{file.shortName}</div>
            <div className="perforce-diff-file__path" title={file.displayPath}>{file.displayPath}</div>
          </div>
          <div className="perforce-diff-file__meta">
            {actionLabel && (
              <span className={getActionBadgeClass(file.action)}>
                {actionLabel}
              </span>
            )}
            {file.revision !== undefined && (
              <span className="perforce-diff-file__revision">#{file.revision}</span>
            )}
          </div>
        </header>
      )}

      <div className="perforce-diff-file__body">
        <Diff
          viewType="unified"
          diffType={file.diffType}
          hunks={file.hunks}
          tokens={tokens}
          className="perforce-react-diff"
          gutterClassName="perforce-react-diff__gutter"
          codeClassName="perforce-react-diff__code"
          lineClassName="perforce-react-diff__line"
          hunkClassName="perforce-react-diff__hunk"
        >
          {(hunks) => hunks.flatMap((hunk, index) => {
            const hunkKey = `${file.key}@@${hunk.oldStart}:${hunk.newStart}:${index}`
            return [
              (
                <Decoration
                  key={`${hunkKey}-decoration`}
                  className="perforce-react-diff__decoration"
                  gutterClassName="perforce-react-diff__decorationGutter"
                  contentClassName="perforce-react-diff__decorationContent"
                >
                  <div className="perforce-react-diff__hunkLabel">{hunk.content}</div>
                </Decoration>
              ),
              <Hunk key={`${hunkKey}-body`} hunk={hunk} />
            ]
          })}
        </Diff>
      </div>
    </section>
  )
}

export function PerforceDiffView({
  diffText,
  fallbackPath,
  fallbackAction,
  showFileHeaders = true,
  ignoreFormattingNoise = false
}: PerforceDiffViewProps) {
  const parsedFiles = useMemo(
    () => parsePerforceDiffFiles(diffText, fallbackPath, fallbackAction),
    [diffText, fallbackAction, fallbackPath]
  )

  const files = useMemo(() => {
    if (!ignoreFormattingNoise) {
      return parsedFiles
    }

    return parsedFiles
      .map((file) => applyFormattingNoiseFilter(file))
      .filter((file): file is ParsedDiffFile => file !== null)
  }, [ignoreFormattingNoise, parsedFiles])

  if (files.length === 0) {
    const emptyMessage = ignoreFormattingNoise && parsedFiles.length > 0
      ? 'Only formatting noise changes were detected'
      : 'This change could not be rendered as text diff'

    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-xl mb-2">No diff available</div>
          <div className="text-sm">{emptyMessage}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="perforce-diff-stack min-w-max">
      {files.map((file) => (
        <DiffFileCard
          key={file.key}
          file={file}
          showHeader={showFileHeaders || files.length > 1}
        />
      ))}
    </div>
  )
}
