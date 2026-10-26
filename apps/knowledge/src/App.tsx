import { lazy, Suspense, useMemo, useState } from "react";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { HelpView } from "./components/HelpView";
import { useDailyReview } from "./hooks/useDailyReview";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import { useInsights } from "./hooks/useInsights";
import { useInsightGroups } from "./hooks/useInsightGroups";
import { useReviewQueueStatus } from "./hooks/useReviewQueueStatus";
import { KnowledgeDashboard } from "./components/KnowledgeDashboard";
import { useKnowledgeNavigation } from "./hooks/useKnowledgeNavigation";
import { useKnowledgeActions } from "./hooks/useKnowledgeActions";
import { confirmReviewResultsDetailed } from "./lib/api";
import { missesToReview } from "./lib/learningSummary";

const ReviewView = lazy(() => import("./components/ReviewView")
  .then((module) => ({ default: module.ReviewView })));
const LearningLogView = lazy(() => import("./components/LearningLogView")
  .then((module) => ({ default: module.LearningLogView })));
const OrganizeView = lazy(() => import("./components/OrganizeView")
  .then((module) => ({ default: module.OrganizeView })));
const SpeakingPracticeView = lazy(() => import("./components/SpeakingPracticeView")
  .then((module) => ({ default: module.SpeakingPracticeView })));
const SemanticSearchView = lazy(() => import("./components/SemanticSearchView")
  .then((module) => ({ default: module.SemanticSearchView })));

export default function App() {
  const data = useKnowledgeData();
  const { knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, updateKnowledge, removeAutoTag, restoreAutoTag, markConfirmed } = data;
  const dailyReview = useDailyReview();
  const reviewQueue = useReviewQueueStatus();
  const insightStore = useInsights();
  const insightGroupStore = useInsightGroups();
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missesOpen, setMissesOpen] = useState(false);
  const navigation = useKnowledgeNavigation({ knowledge, archivedKnowledge, loading, error, reviewQueue, setNotice, setActionError });
  const { showQuiz, showSpeaking, showLog, showSearch, showHelp, helpFrom, setHelpFrom,
    organize, setOrganize, reviewScope, quizMode, logUnconfirmedOnly, selected, replaceRoute,
    setQuizOpen, setSpeakingOpen, setLogOpen, setSearchOpen, setHelpOpen, setOrganizeOpen,
    noteSelection, selectNote, reviewNote, exitReview, openKnowledge, closeKnowledge, setShowHelp } = navigation;
  const actions = useKnowledgeActions({ data, navigation, setNotice, setActionError });
  const { removeAutoTagFrom, openEdit, archiveKnowledge } = actions;

  const registrationKnowledge = useMemo(() => [...knowledge, ...archivedKnowledge], [knowledge, archivedKnowledge]);
  const misses = useMemo(() => missesToReview(quizLog), [quizLog]);

  const confirmMiss = async (quizLogId: number) => {
    const receipt = await confirmReviewResultsDetailed([quizLogId]);
    if (!receipt.confirmedIds.includes(quizLogId)) throw new Error("確認状態を取得できませんでした。学習ログを再読み込みしてください。");
    markConfirmed(receipt.confirmedIds);
    void reviewQueue.refresh();
  };

  const reloadAfterConfirmation = async () => {
    const [loaded] = await Promise.all([reload(), Promise.allSettled([dailyReview.refresh(), reviewQueue.refresh()])]);
    return loaded;
  };
  const reloadAfterReview = async () => { await reloadAfterConfirmation(); };

  if (showQuiz) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <ReviewView
          knowledge={registrationKnowledge}
          knowledgeLoading={loading}
          knowledgeError={error}
          quizLog={quizLog}
          queueStatus={reviewQueue.status}
          onExit={exitReview}
          autoStartDaily={quizMode === "daily"}
          scope={reviewScope}
          onRecorded={reloadAfterReview}
          onKnowledgeUpdate={updateKnowledge}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
          onOpenResults={() => setLogOpen(true, true)}
          onOpenLog={() => setLogOpen(true)}
          missCount={misses.length}
          onOpenMisses={() => { setQuizOpen(false); setMissesOpen(true); }}
        />
      </Suspense>
    );
  }

  if (showSpeaking) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <SpeakingPracticeView
          knowledge={knowledge}
          loading={loading}
          error={error}
          onExit={() => setSpeakingOpen(false)}
        />
      </Suspense>
    );
  }

  if (organize) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <OrganizeView
          tab={organize.tab}
          questionId={organize.questionId}
          allKnowledge={registrationKnowledge}
          activeKnowledge={knowledge}
          insightStore={insightStore}
          groupStore={insightGroupStore}
          loading={loading}
          error={error}
          onTabChange={(tab) => setOrganizeOpen(tab)}
          onOpenKnowledge={openKnowledge}
          onExit={() => setOrganizeOpen(null)}
          onOpenHelp={() => {
            const from = organize;
            setHelpOpen(true);
            setHelpFrom(from);
          }}
          noteSelection={noteSelection}
          onNoteSelect={selectNote}
          onReviewNote={reviewNote}
          onRemoveAutoTag={removeAutoTag}
          onRestoreAutoTag={restoreAutoTag}
        />
        {selected && (
          <KnowledgeDetailModal
            knowledge={selected}
            quizLog={quizLog}
            mutating={mutating}
            onClose={closeKnowledge}
            onEdit={() => openEdit(selected)}
            onArchive={() => void archiveKnowledge(selected)}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
            onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
          />
        )}
      </Suspense>
    );
  }

  if (showSearch) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <SemanticSearchView
          knowledge={registrationKnowledge}
          onOpenKnowledge={openKnowledge}
          onExit={() => setSearchOpen(false)}
        />
        {selected && (
          <KnowledgeDetailModal
            knowledge={selected}
            quizLog={quizLog}
            mutating={mutating}
            onClose={closeKnowledge}
            onEdit={selected.archived ? undefined : () => openEdit(selected)}
            onArchive={selected.archived ? undefined : () => void archiveKnowledge(selected)}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
            onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
          />
        )}
      </Suspense>
    );
  }

  if (showHelp) {
    return (
      <HelpView
        newLimit={dailyReview.status?.new_limit ?? 10}
        section={helpFrom ? "help-organize" : null}
        backLabel={helpFrom ? "整理ページへ戻る" : undefined}
        onExit={() => {
          if (!helpFrom) {
            setHelpOpen(false);
            return;
          }
          const back = helpFrom;
          setHelpFrom(null);
          setShowHelp(false);
          replaceRoute({ kind: "organize", ...back });
          setOrganize(back);
        }}
      />
    );
  }

  if (showLog) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <LearningLogView
          knowledge={registrationKnowledge}
          quizLog={quizLog}
          loading={loading}
          error={error}
          onExit={() => setLogOpen(false)}
          initialUnconfirmedOnly={logUnconfirmedOnly}
          onKnowledgeUpdate={updateKnowledge}
          onReload={reloadAfterConfirmation}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
          onOpenKnowledge={(id) => {
            const item = knowledge.find((entry) => entry.id === id);
            if (item) openKnowledge(item);
          }}
        />
        {/* 問題を作れなかったカードを直せるよう、採点結果の出典（読み取り専用）とは別に編集できる詳細で開く。 */}
        {selected && (
          <KnowledgeDetailModal
            knowledge={selected}
            quizLog={quizLog}
            mutating={mutating}
            onClose={closeKnowledge}
            onEdit={() => { setLogOpen(false); openEdit(selected); }}
            onArchive={() => void archiveKnowledge(selected)}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
            onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
          />
        )}
      </Suspense>
    );
  }

  return <KnowledgeDashboard data={data} navigation={navigation} actions={actions}
    dailyReview={dailyReview} reviewQueue={reviewQueue} insightStore={insightStore} insightGroupStore={insightGroupStore}
    actionError={actionError} setActionError={setActionError} notice={notice} setNotice={setNotice}
    missesOpen={missesOpen} setMissesOpen={setMissesOpen} confirmMiss={confirmMiss} />;
}
