// Projectの抽出・並び順・日付と週次レビューの計算。DOMや通信には触れない。


export function createProjectModel({ state, now = () => new Date() }) {
  function completedDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
  }

  function displayDate(value) {
    if (!value) return "未設定";
    const [year, month, day] = value.split("-");
    return `${Number(month)}/${Number(day)}`;
  }

  function futureDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function todayTokyo() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now());
  }

  function dayDiff(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  }

  function getProject(id) {
    return state.data?.projects.find((project) => project.id === Number(id)) || null;
  }

  function projectsForView() {
    if (!state.data) return [];
    const query = state.search.trim().toLocaleLowerCase("ja");
    return state.data.projects.filter((project) => {
      const viewMatches = state.view === "active"
        ? project.status === "active"
        : state.view === "waiting"
          ? project.status === "waiting" || project.status === "on_hold"
          : project.status === "completed" || project.status === "dropped";
      if (!viewMatches || (state.attentionOnly && !project.needsAttention)) return false;
      if (!query) return true;
      if (typeof project.searchMatched === "boolean") return project.searchMatched;
      const actionText = project.actions.map((action) => action.content).join(" ");
      const itemText = project.items.map((item) => item.sourceContent).join(" ");
      return [project.title, project.outcome, project.theme, actionText, itemText]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ja")
        .includes(query);
    });
  }

  const COMPLETED_PAGE = 10;

  /** サーバーの STALE_DAYS と同じ。停滞の説明に使う。 */
  const STALE_DAYS = 14;

  /** 並び順ごとの説明。要確認をどう扱うかを一覧の上に示す（#142）。 */

  function byDate(field) {
    return (left, right) => {
      const a = left[field];
      const b = right[field];
      if (a && b && a !== b) return a.localeCompare(b);
      if (a !== b) return a ? -1 : 1;
      if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id;
    };
  }

  /** APIの並び（要確認 → 目標日 → 更新）を「おすすめ」とし、ほかは日付で並べ替える。 */
  function sortProjects(projects, sort) {
    if (sort === "target") return [...projects].sort(byDate("targetOn"));
    if (sort === "review") return [...projects].sort(byDate("reviewOn"));
    if (sort === "updated") return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id);
    return projects;
  }

  function staleDays(project, today = todayTokyo()) {
    return dayDiff(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(project.lastActivityAt)), today);
  }

  /** 月曜始まりの今週の初日（JST）。 */
  function weekStartTokyo(today) {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
    return date.toISOString().slice(0, 10);
  }

  /**
   * 週次レビュー（#162）。docs/projects-operation.md の「毎週」を1画面にまとめる。
   * pending は見直しが必要な件数（今週の完了は含めない）。
   */
  function reviewData() {
    const today = todayTokyo();
    const weekStart = weekStartTokyo(today);
    const projects = state.data?.projects || [];
    const open = projects.filter((project) => ["active", "waiting", "on_hold"].includes(project.status));
    const targetOverdue = open.filter((project) => project.targetOn && project.targetOn < today)
      .sort((left, right) => left.targetOn.localeCompare(right.targetOn) || left.id - right.id);
    const overdue = open.flatMap((project) => project.actions
      .filter((action) => (action.status === "next" || action.status === "queued") && action.dueOn && action.dueOn < today)
      .map((action) => ({ project, action })))
      .sort((left, right) => left.action.dueOn.localeCompare(right.action.dueOn));
    const attention = projects.filter((project) => project.needsAttention);
    const reviewDue = open.filter((project) => project.status !== "active" && project.reviewOn && project.reviewOn <= today)
      .sort((left, right) => left.reviewOn.localeCompare(right.reviewOn));
    const stale = projects.filter((project) => project.stale)
      .sort((left, right) => left.lastActivityAt.localeCompare(right.lastActivityAt));
    const doneThisWeek = projects.map((project) => ({
      project,
      actions: project.actions.filter((action) => action.status === "done" && action.completedAt
        && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date(action.completedAt)) >= weekStart),
    })).filter((entry) => entry.actions.length).sort((left, right) => right.actions.length - left.actions.length);
    return {
      today, weekStart, targetOverdue, overdue, attention, reviewDue, stale, doneThisWeek,
      pending: overdue.length + attention.length + reviewDue.length + stale.length + targetOverdue.length,
    };
  }

  return { completedDate, displayDate, futureDate, todayTokyo, dayDiff, getProject, projectsForView, COMPLETED_PAGE, STALE_DAYS, byDate, sortProjects, staleDays, weekStartTokyo, reviewData };
}
