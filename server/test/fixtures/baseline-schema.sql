--
-- PostgreSQL database dump
--

\restrict kEcwkBPnnqnu5bv6B8xkLHLmySCzxoHXOAyxboLZwC4nVMV2wczX141YmudcP3u

-- Dumped from database version 18.3 (Ubuntu 18.3-1.pgdg24.04+1)
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auto_response_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_response_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trigger_type text DEFAULT 'queue_timeout'::text NOT NULL,
    delay_seconds integer DEFAULT 180 NOT NULL,
    message text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_operators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    telegram_id bigint,
    telegram_username text,
    name text,
    email text,
    password_hash text,
    avatar_url text,
    role text DEFAULT 'operator'::text,
    is_online boolean DEFAULT false,
    is_active boolean DEFAULT true,
    last_seen_at timestamp with time zone DEFAULT now(),
    max_concurrent_chats integer DEFAULT 5,
    current_chats_count integer DEFAULT 0,
    total_chats integer DEFAULT 0,
    total_messages integer DEFAULT 0,
    avg_rating double precision DEFAULT 0,
    avg_response_time integer DEFAULT 0,
    status text DEFAULT 'active'::text,
    auth_user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_session_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_session_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_settings (
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#7C5CBF'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    operator_id uuid,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    emoji character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: operator_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid NOT NULL,
    action text NOT NULL,
    session_id uuid,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: proactive_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proactive_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id text NOT NULL,
    operator_id uuid,
    message text DEFAULT 'Здравствуйте! Могу помочь?'::text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    accepted_at timestamp with time zone,
    declined_at timestamp with time zone,
    auto_generated boolean DEFAULT false
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: site_visitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_visitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(100) NOT NULL,
    current_page text,
    current_page_title text,
    referrer text,
    country character varying(100),
    city character varying(100),
    browser character varying(100),
    os character varying(100),
    screen_resolution character varying(30),
    language character varying(20),
    session_count integer DEFAULT 1,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    is_online boolean DEFAULT true,
    has_chat boolean DEFAULT false,
    chat_session_id uuid
);


--
-- Name: visitor_page_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_page_views (
    id bigint NOT NULL,
    visitor_id text NOT NULL,
    url text NOT NULL,
    title text,
    referrer text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: visitor_page_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visitor_page_views_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visitor_page_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visitor_page_views_id_seq OWNED BY public.visitor_page_views.id;


--
-- Name: vk_bot_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vk_bot_attachments (
    id integer NOT NULL,
    kind character varying(20) NOT NULL,
    title character varying(255),
    selectel_key text,
    selectel_url text,
    external_url text,
    vk_attachment character varying(255),
    vk_cached_at timestamp with time zone,
    mime_type character varying(100),
    file_size bigint,
    width integer,
    height integer,
    duration integer,
    sticker_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone
);


--
-- Name: COLUMN vk_bot_attachments.last_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vk_bot_attachments.last_error IS 'Последняя ошибка загрузки в VK';


--
-- Name: COLUMN vk_bot_attachments.last_error_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vk_bot_attachments.last_error_at IS 'Время последней ошибки';


--
-- Name: vk_bot_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vk_bot_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vk_bot_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vk_bot_attachments_id_seq OWNED BY public.vk_bot_attachments.id;


--
-- Name: widget_ab_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_ab_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variant character varying(10) NOT NULL,
    event character varying(50) NOT NULL,
    visitor_id character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: widget_blocked_visitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_blocked_visitors (
    visitor_id text NOT NULL,
    blocked_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_by uuid,
    reason text
);


--
-- Name: widget_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    sender text DEFAULT 'visitor'::text NOT NULL,
    operator_id uuid,
    message text,
    message_type text DEFAULT 'text'::text,
    metadata jsonb,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    attachments jsonb,
    is_edited boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    updated_at timestamp with time zone,
    reply_to_id uuid,
    status text DEFAULT 'sent'::text,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    is_internal boolean DEFAULT false
);


--
-- Name: widget_chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    visitor_phone text,
    operator_id uuid,
    status text DEFAULT 'new'::text,
    unread_count integer DEFAULT 0,
    messages_count integer DEFAULT 0,
    ai_messages_count integer DEFAULT 0,
    operator_messages_count integer DEFAULT 0,
    current_page text,
    country text,
    city text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    time_on_site integer DEFAULT 0,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    first_response_at timestamp with time zone,
    operator_joined_at timestamp with time zone,
    closed_at timestamp with time zone,
    current_page_title text,
    priority text DEFAULT 'normal'::text,
    is_vip boolean DEFAULT false,
    visit_count integer DEFAULT 1,
    queued_at timestamp with time zone,
    auto_replied boolean DEFAULT false,
    form_data jsonb,
    rating integer,
    rating_comment text,
    rated_at timestamp with time zone
);


--
-- Name: widget_offline_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_offline_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(100),
    name character varying(200),
    email character varying(200),
    phone character varying(30),
    message text,
    preferred_time character varying(200),
    page_url character varying(2000),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: widget_scenario_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_scenario_states (
    session_id uuid NOT NULL,
    scenario_id integer NOT NULL,
    current_node_id character varying(120),
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: widget_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_scenarios (
    id integer NOT NULL,
    name character varying(200) DEFAULT 'Сценарий'::character varying NOT NULL,
    description text,
    is_active boolean DEFAULT false NOT NULL,
    start_node_id character varying(120),
    nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    edges jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: widget_scenarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.widget_scenarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: widget_scenarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.widget_scenarios_id_seq OWNED BY public.widget_scenarios.id;


--
-- Name: visitor_page_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_page_views ALTER COLUMN id SET DEFAULT nextval('public.visitor_page_views_id_seq'::regclass);


--
-- Name: vk_bot_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vk_bot_attachments ALTER COLUMN id SET DEFAULT nextval('public.vk_bot_attachments_id_seq'::regclass);


--
-- Name: widget_scenarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_scenarios ALTER COLUMN id SET DEFAULT nextval('public.widget_scenarios_id_seq'::regclass);


--
-- Name: auto_response_rules auto_response_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_rules
    ADD CONSTRAINT auto_response_rules_pkey PRIMARY KEY (id);


--
-- Name: chat_operators chat_operators_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_operators
    ADD CONSTRAINT chat_operators_email_key UNIQUE (email);


--
-- Name: chat_operators chat_operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_operators
    ADD CONSTRAINT chat_operators_pkey PRIMARY KEY (id);


--
-- Name: chat_session_tags chat_session_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_tags
    ADD CONSTRAINT chat_session_tags_pkey PRIMARY KEY (id);


--
-- Name: chat_session_tags chat_session_tags_session_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_tags
    ADD CONSTRAINT chat_session_tags_session_id_tag_id_key UNIQUE (session_id, tag_id);


--
-- Name: chat_settings chat_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_settings
    ADD CONSTRAINT chat_settings_pkey PRIMARY KEY (key);


--
-- Name: chat_tags chat_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_tags
    ADD CONSTRAINT chat_tags_name_key UNIQUE (name);


--
-- Name: chat_tags chat_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_tags
    ADD CONSTRAINT chat_tags_pkey PRIMARY KEY (id);


--
-- Name: client_notes client_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_message_id_operator_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_operator_id_emoji_key UNIQUE (message_id, operator_id, emoji);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: operator_activity_logs operator_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_activity_logs
    ADD CONSTRAINT operator_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: proactive_invitations proactive_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proactive_invitations
    ADD CONSTRAINT proactive_invitations_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_operator_id_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_operator_id_token_key UNIQUE (operator_id, token);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: site_visitors site_visitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_visitors
    ADD CONSTRAINT site_visitors_pkey PRIMARY KEY (id);


--
-- Name: site_visitors site_visitors_visitor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_visitors
    ADD CONSTRAINT site_visitors_visitor_id_key UNIQUE (visitor_id);


--
-- Name: visitor_page_views visitor_page_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_page_views
    ADD CONSTRAINT visitor_page_views_pkey PRIMARY KEY (id);


--
-- Name: vk_bot_attachments vk_bot_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vk_bot_attachments
    ADD CONSTRAINT vk_bot_attachments_pkey PRIMARY KEY (id);


--
-- Name: widget_ab_results widget_ab_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_ab_results
    ADD CONSTRAINT widget_ab_results_pkey PRIMARY KEY (id);


--
-- Name: widget_blocked_visitors widget_blocked_visitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_blocked_visitors
    ADD CONSTRAINT widget_blocked_visitors_pkey PRIMARY KEY (visitor_id);


--
-- Name: widget_chat_messages widget_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_messages
    ADD CONSTRAINT widget_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: widget_chat_sessions widget_chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_sessions
    ADD CONSTRAINT widget_chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: widget_offline_leads widget_offline_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_offline_leads
    ADD CONSTRAINT widget_offline_leads_pkey PRIMARY KEY (id);


--
-- Name: widget_scenario_states widget_scenario_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_scenario_states
    ADD CONSTRAINT widget_scenario_states_pkey PRIMARY KEY (session_id);


--
-- Name: widget_scenarios widget_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_scenarios
    ADD CONSTRAINT widget_scenarios_pkey PRIMARY KEY (id);


--
-- Name: idx_ab_results_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_results_created ON public.widget_ab_results USING btree (created_at DESC);


--
-- Name: idx_activity_logs_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_operator ON public.operator_activity_logs USING btree (operator_id);


--
-- Name: idx_activity_logs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_logs_session ON public.operator_activity_logs USING btree (session_id);


--
-- Name: idx_chat_operators_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_operators_email ON public.chat_operators USING btree (email);


--
-- Name: idx_chat_session_tags_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_session_tags_session ON public.chat_session_tags USING btree (session_id);


--
-- Name: idx_chat_session_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_session_tags_tag ON public.chat_session_tags USING btree (tag_id);


--
-- Name: idx_client_notes_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notes_session ON public.client_notes USING btree (session_id);


--
-- Name: idx_invitations_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_operator ON public.proactive_invitations USING btree (operator_id);


--
-- Name: idx_invitations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_status ON public.proactive_invitations USING btree (status);


--
-- Name: idx_invitations_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_visitor ON public.proactive_invitations USING btree (visitor_id);


--
-- Name: idx_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_status ON public.widget_chat_messages USING btree (status);


--
-- Name: idx_offline_leads_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_leads_created ON public.widget_offline_leads USING btree (created_at DESC);


--
-- Name: idx_reactions_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reactions_message ON public.message_reactions USING btree (message_id);


--
-- Name: idx_sessions_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_priority ON public.widget_chat_sessions USING btree (priority);


--
-- Name: idx_sessions_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_queued ON public.widget_chat_sessions USING btree (queued_at) WHERE (queued_at IS NOT NULL);


--
-- Name: idx_sessions_visitor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_visitor_id ON public.widget_chat_sessions USING btree (visitor_id);


--
-- Name: idx_site_visitors_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_visitors_last_seen ON public.site_visitors USING btree (last_seen_at);


--
-- Name: idx_site_visitors_online; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_site_visitors_online ON public.site_visitors USING btree (is_online) WHERE (is_online = true);


--
-- Name: idx_vpv_visitor_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vpv_visitor_time ON public.visitor_page_views USING btree (visitor_id, occurred_at DESC);


--
-- Name: idx_widget_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_messages_created ON public.widget_chat_messages USING btree (created_at);


--
-- Name: idx_widget_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_messages_session ON public.widget_chat_messages USING btree (session_id);


--
-- Name: idx_widget_sessions_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_sessions_operator ON public.widget_chat_sessions USING btree (operator_id);


--
-- Name: idx_widget_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_sessions_status ON public.widget_chat_sessions USING btree (status);


--
-- Name: idx_widget_sessions_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_sessions_visitor ON public.widget_chat_sessions USING btree (visitor_id);


--
-- Name: ix_vk_bot_attachments_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vk_bot_attachments_kind ON public.vk_bot_attachments USING btree (kind);


--
-- Name: ix_vk_bot_attachments_vk_attachment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vk_bot_attachments_vk_attachment ON public.vk_bot_attachments USING btree (vk_attachment);


--
-- Name: chat_session_tags chat_session_tags_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_tags
    ADD CONSTRAINT chat_session_tags_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.widget_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_session_tags chat_session_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_session_tags
    ADD CONSTRAINT chat_session_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.chat_tags(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id);


--
-- Name: client_notes client_notes_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.widget_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.widget_chat_messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id) ON DELETE CASCADE;


--
-- Name: proactive_invitations proactive_invitations_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proactive_invitations
    ADD CONSTRAINT proactive_invitations_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id);


--
-- Name: push_tokens push_tokens_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id) ON DELETE CASCADE;


--
-- Name: widget_chat_messages widget_chat_messages_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_messages
    ADD CONSTRAINT widget_chat_messages_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id);


--
-- Name: widget_chat_messages widget_chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_messages
    ADD CONSTRAINT widget_chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.widget_chat_messages(id);


--
-- Name: widget_chat_messages widget_chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_messages
    ADD CONSTRAINT widget_chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.widget_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: widget_chat_sessions widget_chat_sessions_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_chat_sessions
    ADD CONSTRAINT widget_chat_sessions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.chat_operators(id);


--
-- PostgreSQL database dump complete
--

\unrestrict kEcwkBPnnqnu5bv6B8xkLHLmySCzxoHXOAyxboLZwC4nVMV2wczX141YmudcP3u

