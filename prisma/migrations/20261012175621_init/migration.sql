-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('draft', 'needs_review', 'approved', 'published', 'retired');

-- CreateEnum
CREATE TYPE "pos" AS ENUM ('noun', 'verb', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'num', 'interj', 'phrase');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('m', 'f', 'mf', 'der', 'die', 'das');

-- CreateEnum
CREATE TYPE "grammatical_number" AS ENUM ('sg', 'pl_only');

-- CreateEnum
CREATE TYPE "register" AS ENUM ('standard', 'familier', 'argot', 'formal');

-- CreateEnum
CREATE TYPE "mastery" AS ENUM ('produce', 'recognize');

-- CreateEnum
CREATE TYPE "token_kind" AS ENUM ('word', 'name', 'number', 'other');

-- CreateEnum
CREATE TYPE "candidate_reason" AS ENUM ('missing', 'name_matches_word');

-- CreateEnum
CREATE TYPE "target_type" AS ENUM ('word', 'grammar');

-- CreateEnum
CREATE TYPE "track" AS ENUM ('reading', 'listening');

-- CreateEnum
CREATE TYPE "question_set" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('mcq', 'tf', 'order', 'match', 'cloze', 'find', 'ctx', 'num', 'dict');

-- CreateEnum
CREATE TYPE "phonics_kind" AS ENUM ('contrast', 'rule', 'liaison');

-- CreateEnum
CREATE TYPE "media_type" AS ENUM ('audio', 'video');

-- CreateEnum
CREATE TYPE "audio_kind" AS ENUM ('word', 'sentence', 'text', 'phonics', 'dialogue');

-- CreateEnum
CREATE TYPE "audio_source" AS ENUM ('tts', 'human');

-- CreateEnum
CREATE TYPE "prompt_kind" AS ENUM ('P-C', 'P-U', 'P-W', 'P-S', 'P-F', 'P-G', 'P-T', 'P-X', 'P-H', 'P-TR', 'P-D', 'P-E', 'P-WR', 'P-QA');

-- CreateEnum
CREATE TYPE "import_state" AS ENUM ('prompt_made', 'pasted', 'imported', 'qa_done', 'reviewed');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('login', 'change_phone');

-- CreateEnum
CREATE TYPE "start_mode" AS ENUM ('zero', 'placement');

-- CreateEnum
CREATE TYPE "pace_mode" AS ENUM ('normal', 'slow');

-- CreateEnum
CREATE TYPE "skill" AS ENUM ('vocab', 'grammar', 'listening', 'reading');

-- CreateEnum
CREATE TYPE "item_type" AS ENUM ('word', 'grammar_unit', 'conjugation');

-- CreateEnum
CREATE TYPE "probation" AS ENUM ('none', 'single', 'sample');

-- CreateEnum
CREATE TYPE "item_source" AS ENUM ('normal', 'tap', 'key_word', 'colloquial', 'i_know', 'pretest', 'placement');

-- CreateEnum
CREATE TYPE "notebook_ref_type" AS ENUM ('word', 'word_gender', 'conjugation', 'grammar_target');

-- CreateEnum
CREATE TYPE "queue_source" AS ENUM ('tap', 'key_word', 'colloquial');

-- CreateEnum
CREATE TYPE "session_scope" AS ENUM ('mixed', 'quick', 'vocab', 'grammar', 'listening', 'reading', 'notebook', 'phonics', 'writing', 'extra');

-- CreateEnum
CREATE TYPE "session_end_reason" AS ENUM ('finished', 'expired', 'replaced');

-- CreateEnum
CREATE TYPE "review_kind" AS ENUM ('intro', 'pretest', 'review', 'followup', 'practice', 'drill', 'text_attempt', 'phonics', 'placement', 'exam', 'self', 'dialogue', 'errorfix');

-- CreateEnum
CREATE TYPE "review_result" AS ENUM ('correct', 'near', 'wrong', 'idk', 'self_ok', 'self_near', 'self_no');

-- CreateEnum
CREATE TYPE "result_reason" AS ENUM ('accent', 'case', 'gender', 'typo');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('my_answer_ok', 'answer_wrong', 'audio', 'translation', 'other');

-- CreateEnum
CREATE TYPE "report_priority" AS ENUM ('normal', 'high');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'fixed', 'rejected');

-- CreateEnum
CREATE TYPE "notice_kind" AS ENUM ('report_fixed');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'paid', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "subscription_source" AS ENUM ('payment', 'manual');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('percent', 'amount');

-- CreateTable
CREATE TABLE "language" (
    "code" VARCHAR(8) NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "coming_soon_fa" TEXT,
    "support_contact_fa" TEXT,

    CONSTRAINT "language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "level_release" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" INTEGER,

    CONSTRAINT "level_release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "name_fa" TEXT NOT NULL,

    CONSTRAINT "concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "code" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "pos" "pos" NOT NULL,
    "gender" "gender",
    "number" "grammatical_number",
    "plural" TEXT,
    "register" "register" NOT NULL DEFAULT 'standard',
    "concept_id" INTEGER,
    "meaning_fa" TEXT,
    "level" VARCHAR(8) NOT NULL,
    "intro_order" INTEGER,
    "no_card" BOOLEAN NOT NULL DEFAULT false,
    "mastery" "mastery" NOT NULL DEFAULT 'produce',
    "sense_of" TEXT,
    "parts" TEXT[],
    "homophones" TEXT[],
    "image" TEXT,
    "audio_id" INTEGER,
    "human_audio_id" INTEGER,
    "note_fa" TEXT,
    "frequency_rank" INTEGER,
    "family" TEXT,
    "collocations" JSONB,
    "mastery_suggested" "mastery",
    "mastery_manual" BOOLEAN NOT NULL DEFAULT false,
    "dup_of_id" INTEGER,

    CONSTRAINT "word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conjugation_table" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "word_id" INTEGER NOT NULL,
    "tense" TEXT NOT NULL,
    "unit_code" TEXT,
    "forms" JSONB NOT NULL,
    "accepted_variants" JSONB NOT NULL DEFAULT '{}',
    "review_card" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conjugation_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "text" TEXT NOT NULL,
    "tts_text" TEXT,
    "translation_fa" TEXT NOT NULL,
    "audio_id" INTEGER,
    "human_audio_id" INTEGER,
    "level" VARCHAR(8),
    "text_hash" TEXT NOT NULL,

    CONSTRAINT "sentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence_word" (
    "id" SERIAL NOT NULL,
    "sentence_id" INTEGER NOT NULL,
    "kind" "token_kind" NOT NULL DEFAULT 'word',
    "word_id" INTEGER,
    "surface" TEXT NOT NULL,
    "spans" JSONB NOT NULL,
    "meaning_fa_ctx" TEXT,
    "suspect" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "code_given" TEXT,
    "candidate_reason" "candidate_reason",

    CONSTRAINT "sentence_word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_exception" (
    "id" SERIAL NOT NULL,
    "surface" TEXT NOT NULL,
    "word_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence_target" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "sentence_id" INTEGER NOT NULL,
    "target_type" "target_type" NOT NULL,
    "target_id" INTEGER NOT NULL,
    "marked_text" TEXT NOT NULL,
    "blanks" INTEGER NOT NULL DEFAULT 1,
    "accepted" JSONB NOT NULL,
    "distractors" JSONB NOT NULL,
    "hint" TEXT,
    "accepted_full" JSONB,

    CONSTRAINT "sentence_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grammar_unit" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "unit_code" TEXT NOT NULL,
    "order_no" INTEGER,
    "title_fa" TEXT NOT NULL,
    "scope_fa" TEXT,
    "can_do_fa" TEXT,
    "level" VARCHAR(8) NOT NULL,
    "lesson_fa" TEXT,
    "build_table" JSONB,
    "example_sentence_ids" INTEGER[],
    "rule_line_fa" TEXT,
    "common_mistake_fa" TEXT,
    "category_sets" JSONB,

    CONSTRAINT "grammar_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transform_item" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "grammar_unit_id" INTEGER NOT NULL,
    "instruction_fa" TEXT NOT NULL,
    "source_sentence" TEXT NOT NULL,
    "accepted_outputs" TEXT[],

    CONSTRAINT "transform_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translate_item" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "grammar_unit_id" INTEGER NOT NULL,
    "prompt_fa" TEXT NOT NULL,
    "accepted_outputs" TEXT[],
    "tokens" JSONB NOT NULL,

    CONSTRAINT "translate_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "code" TEXT NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "band" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sentence_ids" INTEGER[],
    "speakers" JSONB,
    "media_type" "media_type" NOT NULL DEFAULT 'audio',
    "video_url" TEXT,
    "audio_id" INTEGER,
    "sentence_offsets_ms" INTEGER[],
    "human_audio_id" INTEGER,
    "human_sentence_offsets_ms" INTEGER[],
    "duration_sec" DOUBLE PRECISION,
    "word_count" INTEGER,
    "key_word_ids" INTEGER[],
    "placement_ok" BOOLEAN NOT NULL DEFAULT false,
    "difficulty_score" DOUBLE PRECISION,
    "order_override" INTEGER,

    CONSTRAINT "text_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "text_id" INTEGER NOT NULL,
    "track" "track" NOT NULL,
    "set" "question_set" NOT NULL,
    "order_no" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "explanation_fa" TEXT,

    CONSTRAINT "question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialogue" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "code" TEXT NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "title_fa" TEXT NOT NULL,
    "situation_fa" TEXT NOT NULL,
    "turns" JSONB NOT NULL,

    CONSTRAINT "dialogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "errorfix_item" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "marked_text" TEXT NOT NULL,
    "translation_fa" TEXT NOT NULL,
    "unit_codes" TEXT[],
    "errors" JSONB NOT NULL,
    "tokens" JSONB,

    CONSTRAINT "errorfix_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_task" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "prompt_fa" TEXT NOT NULL,
    "min_words" INTEGER NOT NULL,
    "max_words" INTEGER NOT NULL,
    "checklist_fa" TEXT[],
    "useful_phrases" JSONB NOT NULL,
    "model_answer" TEXT NOT NULL,
    "model_answer_fa" TEXT NOT NULL,

    CONSTRAINT "writing_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "name_fa" TEXT NOT NULL,
    "separate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phonics_lesson" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "prompt_version" TEXT,
    "model_name" TEXT,
    "import_batch_id" INTEGER,
    "module_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "order_no" INTEGER,
    "kind" "phonics_kind" NOT NULL,
    "sound_label" TEXT NOT NULL,
    "graphemes" TEXT[],
    "tip_fa" TEXT NOT NULL,
    "example_words" JSONB NOT NULL DEFAULT '[]',
    "minimal_pairs" JSONB NOT NULL DEFAULT '[]',
    "liaison_sentences" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "phonics_lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_asset" (
    "id" SERIAL NOT NULL,
    "kind" "audio_kind" NOT NULL,
    "url" TEXT NOT NULL,
    "source" "audio_source" NOT NULL,
    "voice" TEXT,
    "duration_ms" INTEGER,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" INTEGER,
    "listened_by" INTEGER,
    "listened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frequency_item" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "rank" INTEGER NOT NULL,
    "lemma" TEXT NOT NULL,
    "used_in_batch_id" INTEGER,

    CONSTRAINT "frequency_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "prompt_kind" "prompt_kind" NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_name" TEXT,
    "prompt_text" TEXT NOT NULL,
    "raw_output" TEXT,
    "report" JSONB,
    "qa_findings" JSONB,
    "state" "import_state" NOT NULL DEFAULT 'prompt_made',
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "params" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_length_min" INTEGER NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "admin_language" VARCHAR(8),
    "is_tester" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_code" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "otp_purpose" NOT NULL DEFAULT 'login',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(3),
    "test_code" TEXT,

    CONSTRAINT "otp_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_device" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_started_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "start_mode" "start_mode",
    "placement_done" BOOLEAN NOT NULL DEFAULT false,
    "phonics_auto" BOOLEAN NOT NULL DEFAULT false,
    "phonics_done" BOOLEAN NOT NULL DEFAULT false,
    "phonics_skips" INTEGER NOT NULL DEFAULT 0,
    "last_spread_date" DATE,
    "pace_mode" "pace_mode" NOT NULL DEFAULT 'normal',
    "pretest_mode" BOOLEAN NOT NULL DEFAULT false,
    "streak_count" INTEGER NOT NULL DEFAULT 0,
    "streak_last_date" DATE,
    "streak_forgiven_week" DATE,
    "freeze_count" INTEGER NOT NULL DEFAULT 0,
    "freeze_checked_week" DATE,
    "leveldown_asked_at" TIMESTAMPTZ(3),
    "shorten_asked_at" TIMESTAMPTZ(3),
    "longer_asked_at" TIMESTAMPTZ(3),
    "text_prompt_date" DATE,
    "install_prompt_count" INTEGER NOT NULL DEFAULT 0,
    "writing_done_week" DATE,
    "path_done_at" TIMESTAMPTZ(3),

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_level" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "skill" "skill" NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "known_below" VARCHAR(8),

    CONSTRAINT "skill_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "item_type" "item_type" NOT NULL,
    "item_id" INTEGER NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "fsrs" JSONB NOT NULL,
    "probation" "probation" NOT NULL DEFAULT 'none',
    "source" "item_source" NOT NULL DEFAULT 'normal',
    "introduced_at" TIMESTAMPTZ(3),
    "first_review_done" BOOLEAN NOT NULL DEFAULT false,
    "typed_once" BOOLEAN NOT NULL DEFAULT false,
    "deferred_until" TIMESTAMPTZ(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "near_streak" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "rounds_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confusion_pair" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "word_id" INTEGER NOT NULL,
    "other_word_id" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "last_at" TIMESTAMPTZ(3) NOT NULL,
    "card_shown_at" TIMESTAMPTZ(3),

    CONSTRAINT "confusion_pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "text_id" INTEGER NOT NULL,
    "track" "track" NOT NULL,
    "attempts_done" INTEGER NOT NULL DEFAULT 0,
    "first_score" DOUBLE PRECISION,
    "scores" JSONB NOT NULL DEFAULT '[]',
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "partial" JSONB,
    "partial_until" TIMESTAMPTZ(3),
    "used_in_test" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "text_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phonics_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "rounds_done" INTEGER NOT NULL DEFAULT 0,
    "last_score" DOUBLE PRECISION,
    "next_at" TIMESTAMPTZ(3),
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "phonics_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentence_drill_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "sentence_id" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "last_at" TIMESTAMPTZ(3),

    CONSTRAINT "sentence_drill_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speak_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "sentence_id" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "last_rating" TEXT,
    "next_at" TIMESTAMPTZ(3),

    CONSTRAINT "speak_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialogue_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "dialogue_id" INTEGER NOT NULL,
    "attempts_done" INTEGER NOT NULL DEFAULT 0,
    "scores" JSONB NOT NULL DEFAULT '[]',
    "next_attempt_at" TIMESTAMPTZ(3),

    CONSTRAINT "dialogue_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "errorfix_state" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "errorfix_item_id" INTEGER NOT NULL,
    "attempts_done" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "next_attempt_at" TIMESTAMPTZ(3),

    CONSTRAINT "errorfix_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_entry" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "writing_task_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "checklist_ticks" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notebook_entry" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "ref_type" "notebook_ref_type" NOT NULL,
    "ref_id" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMPTZ(3) NOT NULL,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "last_correct_date" DATE,

    CONSTRAINT "notebook_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "new_word_queue" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "word_id" INTEGER NOT NULL,
    "source" "queue_source" NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "new_word_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_counter" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "date_tehran" DATE NOT NULL,
    "new_words" INTEGER NOT NULL DEFAULT 0,
    "words_cap_today" INTEGER,
    "cap_prompt_shown" BOOLEAN NOT NULL DEFAULT false,
    "queue_words" INTEGER NOT NULL DEFAULT 0,
    "new_units" INTEGER NOT NULL DEFAULT 0,
    "new_conj" INTEGER NOT NULL DEFAULT 0,
    "new_text_sec_reading" INTEGER NOT NULL DEFAULT 0,
    "new_text_sec_listening" INTEGER NOT NULL DEFAULT 0,
    "i_know" INTEGER NOT NULL DEFAULT 0,
    "pretest_passed" INTEGER NOT NULL DEFAULT 0,
    "text_session_done" BOOLEAN NOT NULL DEFAULT false,
    "active_sec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "scope" "session_scope" NOT NULL,
    "planned_length_min" INTEGER NOT NULL,
    "is_text_session" BOOLEAN NOT NULL DEFAULT false,
    "no_audio" BOOLEAN NOT NULL DEFAULT false,
    "plan" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "next_seq" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_answer_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "session_end_reason",

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_log" (
    "id" UUID NOT NULL,
    "user_id" INTEGER,
    "language" VARCHAR(8) NOT NULL,
    "session_id" UUID,
    "kind" "review_kind" NOT NULL,
    "item_type" TEXT,
    "item_id" INTEGER,
    "exercise_code" TEXT,
    "step_before" INTEGER,
    "step_after" INTEGER,
    "sentence_id" INTEGER,
    "sentence_target_id" INTEGER,
    "question_id" INTEGER,
    "question_set" "question_set",
    "result" "review_result" NOT NULL,
    "result_reason" "result_reason",
    "raw_answer" TEXT,
    "chosen_word_id" INTEGER,
    "first_typing" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "fsrs_rating" INTEGER,
    "seq" INTEGER,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_run" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "state" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "result" JSONB,
    "sample_state" JSONB,

    CONSTRAINT "placement_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_exam" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "skill" "skill" NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,

    CONSTRAINT "level_exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_report" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "review_log_id" UUID,
    "item_type" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "exercise_code" TEXT,
    "sentence_id" INTEGER,
    "reason" "report_reason" NOT NULL,
    "raw_answer" TEXT,
    "note" TEXT,
    "priority" "report_priority" NOT NULL DEFAULT 'normal',
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notice" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "kind" "notice_kind" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "language" VARCHAR(8),
    "name" TEXT NOT NULL,
    "props" JSONB,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan" (
    "id" SERIAL NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "name_fa" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "price_toman" INTEGER NOT NULL,
    "badge_fa" TEXT,
    "module_codes" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_code" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" "discount_type" NOT NULL,
    "value" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "max_uses_total" INTEGER,
    "max_uses_per_user" INTEGER NOT NULL DEFAULT 1,
    "plan_ids" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "discount_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_use" (
    "id" SERIAL NOT NULL,
    "code_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,

    CONSTRAINT "discount_use_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "amount_toman" INTEGER NOT NULL,
    "discount_code_id" INTEGER,
    "final_amount" INTEGER NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "gateway" TEXT NOT NULL,
    "authority" TEXT,
    "gateway_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "last_verify_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "plan_id" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "subscription_source" NOT NULL,
    "order_id" INTEGER,
    "granted_by" INTEGER,
    "note" TEXT,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_ledger" (
    "id" SERIAL NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "default_value" JSONB NOT NULL,
    "min_value" DOUBLE PRECISION,
    "max_value" DOUBLE PRECISION,
    "description_fa" TEXT NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engine_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admin_log" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_log" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "where" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "user_id" INTEGER,
    "request_id" TEXT,

    CONSTRAINT "error_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "level_release_language_level_key" ON "level_release"("language", "level");

-- CreateIndex
CREATE UNIQUE INDEX "concept_language_name_fa_key" ON "concept"("language", "name_fa");

-- CreateIndex
CREATE INDEX "word_language_lemma_idx" ON "word"("language", "lemma");

-- CreateIndex
CREATE INDEX "word_language_level_intro_order_idx" ON "word"("language", "level", "intro_order");

-- CreateIndex
CREATE INDEX "word_language_status_idx" ON "word"("language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "word_language_code_key" ON "word"("language", "code");

-- CreateIndex
CREATE INDEX "conjugation_table_language_status_idx" ON "conjugation_table"("language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conjugation_table_word_id_tense_key" ON "conjugation_table"("word_id", "tense");

-- CreateIndex
CREATE INDEX "sentence_language_status_idx" ON "sentence"("language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sentence_language_text_hash_key" ON "sentence"("language", "text_hash");

-- CreateIndex
CREATE INDEX "sentence_word_word_id_idx" ON "sentence_word"("word_id");

-- CreateIndex
CREATE UNIQUE INDEX "sentence_word_sentence_id_position_key" ON "sentence_word"("sentence_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "form_exception_word_id_surface_key" ON "form_exception"("word_id", "surface");

-- CreateIndex
CREATE INDEX "sentence_target_target_type_target_id_idx" ON "sentence_target"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "sentence_target_sentence_id_idx" ON "sentence_target"("sentence_id");

-- CreateIndex
CREATE INDEX "sentence_target_language_status_idx" ON "sentence_target"("language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "grammar_unit_unit_code_key" ON "grammar_unit"("unit_code");

-- CreateIndex
CREATE INDEX "grammar_unit_language_level_order_no_idx" ON "grammar_unit"("language", "level", "order_no");

-- CreateIndex
CREATE INDEX "grammar_unit_language_status_idx" ON "grammar_unit"("language", "status");

-- CreateIndex
CREATE INDEX "transform_item_grammar_unit_id_idx" ON "transform_item"("grammar_unit_id");

-- CreateIndex
CREATE INDEX "translate_item_grammar_unit_id_idx" ON "translate_item"("grammar_unit_id");

-- CreateIndex
CREATE INDEX "text_language_level_idx" ON "text"("language", "level");

-- CreateIndex
CREATE INDEX "text_language_status_idx" ON "text"("language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "text_language_code_key" ON "text"("language", "code");

-- CreateIndex
CREATE INDEX "question_text_id_track_set_order_no_idx" ON "question"("text_id", "track", "set", "order_no");

-- CreateIndex
CREATE INDEX "dialogue_language_level_idx" ON "dialogue"("language", "level");

-- CreateIndex
CREATE UNIQUE INDEX "dialogue_language_code_key" ON "dialogue"("language", "code");

-- CreateIndex
CREATE INDEX "errorfix_item_language_level_idx" ON "errorfix_item"("language", "level");

-- CreateIndex
CREATE INDEX "writing_task_language_level_idx" ON "writing_task"("language", "level");

-- CreateIndex
CREATE UNIQUE INDEX "module_code_key" ON "module"("code");

-- CreateIndex
CREATE INDEX "phonics_lesson_language_order_no_idx" ON "phonics_lesson"("language", "order_no");

-- CreateIndex
CREATE INDEX "frequency_item_language_lemma_idx" ON "frequency_item"("language", "lemma");

-- CreateIndex
CREATE UNIQUE INDEX "frequency_item_language_rank_key" ON "frequency_item"("language", "rank");

-- CreateIndex
CREATE INDEX "import_batch_language_state_idx" ON "import_batch"("language", "state");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_key" ON "user"("phone");

-- CreateIndex
CREATE INDEX "otp_code_phone_created_at_idx" ON "otp_code"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_code_ip_created_at_idx" ON "otp_code"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_device_refresh_token_hash_key" ON "auth_device"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_device_user_id_idx" ON "auth_device"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_user_id_language_key" ON "enrollment"("user_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "skill_level_user_id_language_skill_key" ON "skill_level"("user_id", "language", "skill");

-- CreateIndex
CREATE INDEX "item_state_user_id_language_idx" ON "item_state"("user_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "item_state_user_id_item_type_item_id_key" ON "item_state"("user_id", "item_type", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "confusion_pair_user_id_word_id_other_word_id_key" ON "confusion_pair"("user_id", "word_id", "other_word_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_state_user_id_text_id_track_key" ON "text_state"("user_id", "text_id", "track");

-- CreateIndex
CREATE UNIQUE INDEX "phonics_state_user_id_lesson_id_key" ON "phonics_state"("user_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "sentence_drill_state_user_id_sentence_id_key" ON "sentence_drill_state"("user_id", "sentence_id");

-- CreateIndex
CREATE UNIQUE INDEX "speak_state_user_id_sentence_id_key" ON "speak_state"("user_id", "sentence_id");

-- CreateIndex
CREATE UNIQUE INDEX "dialogue_state_user_id_dialogue_id_key" ON "dialogue_state"("user_id", "dialogue_id");

-- CreateIndex
CREATE UNIQUE INDEX "errorfix_state_user_id_errorfix_item_id_key" ON "errorfix_state"("user_id", "errorfix_item_id");

-- CreateIndex
CREATE INDEX "writing_entry_user_id_idx" ON "writing_entry"("user_id");

-- CreateIndex
CREATE INDEX "notebook_entry_user_id_language_idx" ON "notebook_entry"("user_id", "language");

-- CreateIndex
CREATE INDEX "new_word_queue_user_id_language_idx" ON "new_word_queue"("user_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "new_word_queue_user_id_word_id_key" ON "new_word_queue"("user_id", "word_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_counter_user_id_language_date_tehran_key" ON "daily_counter"("user_id", "language", "date_tehran");

-- CreateIndex
CREATE INDEX "session_user_id_language_ended_at_idx" ON "session"("user_id", "language", "ended_at");

-- CreateIndex
CREATE INDEX "review_log_user_id_language_ts_idx" ON "review_log"("user_id", "language", "ts");

-- CreateIndex
CREATE INDEX "review_log_session_id_seq_idx" ON "review_log"("session_id", "seq");

-- CreateIndex
CREATE INDEX "review_log_item_type_item_id_idx" ON "review_log"("item_type", "item_id");

-- CreateIndex
CREATE INDEX "placement_run_user_id_language_idx" ON "placement_run"("user_id", "language");

-- CreateIndex
CREATE INDEX "level_exam_user_id_language_skill_idx" ON "level_exam"("user_id", "language", "skill");

-- CreateIndex
CREATE INDEX "content_report_status_priority_idx" ON "content_report"("status", "priority");

-- CreateIndex
CREATE INDEX "content_report_item_type_item_id_idx" ON "content_report"("item_type", "item_id");

-- CreateIndex
CREATE INDEX "user_notice_user_id_language_seen_at_idx" ON "user_notice"("user_id", "language", "seen_at");

-- CreateIndex
CREATE INDEX "event_name_ts_idx" ON "event"("name", "ts");

-- CreateIndex
CREATE INDEX "plan_language_active_sort_order_idx" ON "plan"("language", "active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_code_key" ON "discount_code"("code");

-- CreateIndex
CREATE INDEX "discount_use_code_id_user_id_idx" ON "discount_use"("code_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_use_order_id_key" ON "discount_use"("order_id");

-- CreateIndex
CREATE INDEX "order_user_id_idx" ON "order"("user_id");

-- CreateIndex
CREATE INDEX "order_status_created_at_idx" ON "order"("status", "created_at");

-- CreateIndex
CREATE INDEX "subscription_user_id_language_ends_at_idx" ON "subscription"("user_id", "language", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "trial_ledger_phone_hash_language_key" ON "trial_ledger"("phone_hash", "language");

-- CreateIndex
CREATE INDEX "admin_log_entity_entity_id_ts_idx" ON "admin_log"("entity", "entity_id", "ts");

-- CreateIndex
CREATE INDEX "admin_log_ts_idx" ON "admin_log"("ts");

-- CreateIndex
CREATE INDEX "error_log_ts_idx" ON "error_log"("ts");

-- AddForeignKey
ALTER TABLE "word" ADD CONSTRAINT "word_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conjugation_table" ADD CONSTRAINT "conjugation_table_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_word" ADD CONSTRAINT "sentence_word_sentence_id_fkey" FOREIGN KEY ("sentence_id") REFERENCES "sentence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_word" ADD CONSTRAINT "sentence_word_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_exception" ADD CONSTRAINT "form_exception_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_target" ADD CONSTRAINT "sentence_target_sentence_id_fkey" FOREIGN KEY ("sentence_id") REFERENCES "sentence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transform_item" ADD CONSTRAINT "transform_item_grammar_unit_id_fkey" FOREIGN KEY ("grammar_unit_id") REFERENCES "grammar_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translate_item" ADD CONSTRAINT "translate_item_grammar_unit_id_fkey" FOREIGN KEY ("grammar_unit_id") REFERENCES "grammar_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question" ADD CONSTRAINT "question_text_id_fkey" FOREIGN KEY ("text_id") REFERENCES "text"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_device" ADD CONSTRAINT "auth_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_level" ADD CONSTRAINT "skill_level_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_state" ADD CONSTRAINT "item_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confusion_pair" ADD CONSTRAINT "confusion_pair_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_state" ADD CONSTRAINT "text_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phonics_state" ADD CONSTRAINT "phonics_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentence_drill_state" ADD CONSTRAINT "sentence_drill_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speak_state" ADD CONSTRAINT "speak_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_state" ADD CONSTRAINT "dialogue_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "errorfix_state" ADD CONSTRAINT "errorfix_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_entry" ADD CONSTRAINT "writing_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook_entry" ADD CONSTRAINT "notebook_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "new_word_queue" ADD CONSTRAINT "new_word_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_counter" ADD CONSTRAINT "daily_counter_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_run" ADD CONSTRAINT "placement_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_exam" ADD CONSTRAINT "level_exam_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notice" ADD CONSTRAINT "user_notice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_use" ADD CONSTRAINT "discount_use_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "discount_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
