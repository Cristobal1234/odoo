/** @odoo-module **/

import { registerMessagingComponent } from '@mail/utils/messaging_component';
import { useUpdate } from '@mail/component_hooks/use_update/use_update';
import { isEventHandled, markEventHandled } from '@mail/utils/utils';

import { _lt } from 'web.core';
import { format } from 'web.field_utils';
import { getLangDatetimeFormat } from 'web.time';

const { Component, useState } = owl;
const { useRef } = owl.hooks;

const READ_MORE = _lt("read more");
const READ_LESS = _lt("read less");

export class Message extends Component {

    /**
     * @override
     */
    constructor(...args) {
        super(...args);
        this.state = useState({
            /**
             * Determine whether the message is clicked. When message is in
             * clicked state, it keeps displaying the commands.
             */
            isClicked: false,
        });
        useUpdate({ func: () => this._update() });
        /**
         * The intent of the reply button depends on the last rendered state.
         */
        this._wasSelected;
        /**
         * Value of the last rendered prettyBody. Useful to compare to new value
         * to decide if it has to be updated.
         */
        this._lastPrettyBody;
        /**
         * Reference to element containing the prettyBody. Useful to be able to
         * replace prettyBody with new value in JS (which is faster than t-raw).
         */
        this._prettyBodyRef = useRef('prettyBody');
        /**
         * Reference to the content of the message.
         */
        this._contentRef = useRef('content');
        /**
         * To get checkbox state.
         */
        this._checkboxRef = useRef('checkbox');
        /**
         * Id of setInterval used to auto-update time elapsed of message at
         * regular time.
         */
        this._intervalId = undefined;
        this._constructor();
    }

    /**
     * Allows patching constructor.
     */
    _constructor() {}

    willUnmount() {
        clearInterval(this._intervalId);
    }

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * @returns {string}
     */
    get avatar() {
        if (this.message.author) {
            // TODO FIXME for public user this might not be accessible. task-2223236
            // we should probably use the correspondig attachment id + access token
            // or create a dedicated route to get message image, checking the access right of the message
            return this.message.author.avatarUrl;
        } else if (this.message.message_type === 'email') {
            return '/mail/static/src/img/email_icon.png';
        }
        return '/mail/static/src/img/smiley/avatar.jpg';
    }

    /**
     * Get the date time of the message at current user locale time.
     *
     * @returns {string}
     */
    get datetime() {
        return this.message.date.format(getLangDatetimeFormat());
    }

    /**
     * Determines whether author open chat feature is enabled on message.
     *
     * @returns {boolean}
     */
    get hasAuthorOpenChat() {
        if (!this.message.author) {
            return false;
        }
        if (
            this.threadView &&
            this.threadView.thread &&
            this.threadView.thread.correspondent === this.message.author
        ) {
            return false;
        }
        return true;
    }

    /**
     * Tell whether the bottom of this message is visible or not.
     *
     * @param {Object} param0
     * @param {integer} [offset=0]
     * @returns {boolean}
     */
    isBottomVisible({ offset=0 } = {}) {
        if (!this.el) {
            return false;
        }
        const elRect = this.el.getBoundingClientRect();
        if (!this.el.parentNode) {
            return false;
        }
        const parentRect = this.el.parentNode.getBoundingClientRect();
        // bottom with (double) 10px offset
        return (
            elRect.bottom < parentRect.bottom + offset &&
            parentRect.top < elRect.bottom + offset
        );
    }

    /**
     * Tell whether the message is partially visible on browser window or not.
     *
     * @returns {boolean}
     */
    isPartiallyVisible() {
        const elRect = this.el.getBoundingClientRect();
        if (!this.el.parentNode) {
            return false;
        }
        const parentRect = this.el.parentNode.getBoundingClientRect();
        // intersection with 5px offset
        return (
            elRect.top < parentRect.bottom + 5 &&
            parentRect.top < elRect.bottom + 5
        );
    }

    /**
     * Tell whether the message is selected in the current thread viewer.
     *
     * @returns {boolean}
     */
    get isSelected() {
        return (
            this.threadView &&
            this.threadView.threadViewer &&
            this.threadView.threadViewer.selectedMessage === this.message
        );
    }

    /**
     * @returns {mail.message}
     */
    get message() {
        return this.messaging && this.messaging.models['mail.message'].get(this.props.messageLocalId);
    }
    /**
     * @returns {string}
     */
    get OPEN_CHAT() {
        return this.env._t("Open chat");
    }

    /**
     * Make this message viewable in its enclosing scroll environment (usually
     * message list).
     *
     * @param {Object} [param0={}]
     * @param {string} [param0.behavior='auto']
     * @param {string} [param0.block='end']
     * @returns {Promise}
     */
    async scrollIntoView({ behavior = 'auto', block = 'end' } = {}) {
        this.el.scrollIntoView({
            behavior,
            block,
            inline: 'nearest',
        });
        if (behavior === 'smooth') {
            return new Promise(resolve => setTimeout(resolve, 500));
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Get the shorttime format of the message date.
     *
     * @returns {string}
     */
    get shortTime() {
        return this.message.date.format('hh:mm');
    }

    /**
     * @returns {mail.thread_view}
     */
    get threadView() {
        return this.messaging && this.messaging.models['mail.thread_view'].get(this.props.threadViewLocalId);
    }

    /**
     * @returns {Object}
     */
    get trackingValues() {
        return this.message.tracking_value_ids.map(trackingValue => {
            const value = Object.assign({}, trackingValue);
            value.changed_field = _.str.sprintf(this.env._t("%s:"), value.changed_field);
            /**
             * Maps tracked field type to a JS formatter. Tracking values are
             * not always stored in the same field type as their origin type.
             * Field types that are not listed here are not supported by
             * tracking in Python. Also see `create_tracking_values` in Python.
             */
            switch (value.field_type) {
                case 'boolean':
                    value.old_value = format.boolean(value.old_value, undefined, { forceString: true });
                    value.new_value = format.boolean(value.new_value, undefined, { forceString: true });
                    break;
                /**
                 * many2one formatter exists but is expecting id/name_get or data
                 * object but only the target record name is known in this context.
                 *
                 * Selection formatter exists but requires knowing all
                 * possibilities and they are not given in this context.
                 */
                case 'char':
                case 'many2one':
                case 'selection':
                    value.old_value = format.char(value.old_value);
                    value.new_value = format.char(value.new_value);
                    break;
                case 'date':
                    if (value.old_value) {
                        value.old_value = moment.utc(value.old_value);
                    }
                    if (value.new_value) {
                        value.new_value = moment.utc(value.new_value);
                    }
                    value.old_value = format.date(value.old_value);
                    value.new_value = format.date(value.new_value);
                    break;
                case 'datetime':
                    if (value.old_value) {
                        value.old_value = moment.utc(value.old_value);
                    }
                    if (value.new_value) {
                        value.new_value = moment.utc(value.new_value);
                    }
                    value.old_value = format.datetime(value.old_value);
                    value.new_value = format.datetime(value.new_value);
                    break;
                case 'float':
                    value.old_value = format.float(value.old_value);
                    value.new_value = format.float(value.new_value);
                    break;
                case 'integer':
                    value.old_value = format.integer(value.old_value);
                    value.new_value = format.integer(value.new_value);
                    break;
                case 'monetary':
                    value.old_value = format.monetary(value.old_value, undefined, {
                        currency: value.currency_id
                            ? this.env.session.currencies[value.currency_id]
                            : undefined,
                        forceString: true,
                    });
                    value.new_value = format.monetary(value.new_value, undefined, {
                        currency: value.currency_id
                            ? this.env.session.currencies[value.currency_id]
                            : undefined,
                        forceString: true,
                    });
                    break;
                case 'text':
                    value.old_value = format.text(value.old_value);
                    value.new_value = format.text(value.new_value);
                    break;
            }
            return value;
        });
    }

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Modifies the message to add the 'read more/read less' functionality
     * All element nodes with 'data-o-mail-quote' attribute are concerned.
     * All text nodes after a ``#stopSpelling`` element are concerned.
     * Those text nodes need to be wrapped in a span (toggle functionality).
     * All consecutive elements are joined in one 'read more/read less'.
     *
     * FIXME This method should be rewritten (task-2308951)
     *
     * @private
     * @param {jQuery} $element
     */
    _insertReadMoreLess($element) {
        const groups = [];
        let readMoreNodes;

        // nodeType 1: element_node
        // nodeType 3: text_node
        const $children = $element.contents()
            .filter((index, content) =>
                content.nodeType === 1 || (content.nodeType === 3 && content.nodeValue.trim())
            );

        for (const child of $children) {
            let $child = $(child);

            // Hide Text nodes if "stopSpelling"
            if (
                child.nodeType === 3 &&
                $child.prevAll('[id*="stopSpelling"]').length > 0
            ) {
                // Convert Text nodes to Element nodes
                $child = $('<span>', {
                    text: child.textContent,
                    'data-o-mail-quote': '1',
                });
                child.parentNode.replaceChild($child[0], child);
            }

            // Create array for each 'read more' with nodes to toggle
            if (
                $child.attr('data-o-mail-quote') ||
                (
                    $child.get(0).nodeName === 'BR' &&
                    $child.prev('[data-o-mail-quote="1"]').length > 0
                )
            ) {
                if (!readMoreNodes) {
                    readMoreNodes = [];
                    groups.push(readMoreNodes);
                }
                $child.hide();
                readMoreNodes.push($child);
            } else {
                readMoreNodes = undefined;
                this._insertReadMoreLess($child);
            }
        }

        for (const group of groups) {
            // Insert link just before the first node
            const $readMoreLess = $('<a>', {
                class: 'o_Message_readMoreLess',
                href: '#',
                text: READ_MORE,
            }).insertBefore(group[0]);

            // Toggle All next nodes
            let isReadMore = true;
            $readMoreLess.click(e => {
                e.preventDefault();
                isReadMore = !isReadMore;
                for (const $child of group) {
                    $child.hide();
                    $child.toggle(!isReadMore);
                }
                $readMoreLess.text(isReadMore ? READ_MORE : READ_LESS);
            });
        }
    }

    /**
     * @private
     */
    _update() {
        if (!this.message) {
            return;
        }
        if (this._prettyBodyRef.el && this.message.prettyBody !== this._lastPrettyBody) {
            this._prettyBodyRef.el.innerHTML = this.message.prettyBody;
            this._lastPrettyBody = this.message.prettyBody;
        }
        // Remove all readmore before if any before reinsert them with _insertReadMoreLess.
        // This is needed because _insertReadMoreLess is working with direct DOM mutations
        // which are not sync with Owl.
        if (this._contentRef.el) {
            for (const el of [...this._contentRef.el.querySelectorAll(':scope .o_Message_readMoreLess')]) {
                el.remove();
            }
            this._insertReadMoreLess($(this._contentRef.el));
            this.message.messaging.messagingBus.trigger('o-component-message-read-more-less-inserted', {
                message: this.message,
            });
        }
        this._wasSelected = this.isSelected;
        this.message.refreshDateFromNow();
        clearInterval(this._intervalId);
        this._intervalId = setInterval(() => {
            this.message.refreshDateFromNow();
        }, 60 * 1000);
    }

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClick(ev) {
        if (ev.target.closest('.o_channel_redirect')) {
            this.message.messaging.openProfile({
                id: Number(ev.target.dataset.oeId),
                model: 'mail.channel',
            });
            // avoid following dummy href
            ev.preventDefault();
            return;
        }
        if (ev.target.tagName === 'A') {
            if (ev.target.dataset.oeId && ev.target.dataset.oeModel) {
                this.message.messaging.openProfile({
                    id: Number(ev.target.dataset.oeId),
                    model: ev.target.dataset.oeModel,
                });
                // avoid following dummy href
                ev.preventDefault();
            }
            return;
        }
        if (
            !isEventHandled(ev, 'Message.ClickAuthorAvatar') &&
            !isEventHandled(ev, 'Message.ClickAuthorName') &&
            !isEventHandled(ev, 'Message.ClickFailure')
        ) {
            this.state.isClicked = !this.state.isClicked;
        }
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickAuthorAvatar(ev) {
        markEventHandled(ev, 'Message.ClickAuthorAvatar');
        if (!this.hasAuthorOpenChat) {
            return;
        }
        this.message.author.openChat();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickAuthorName(ev) {
        markEventHandled(ev, 'Message.ClickAuthorName');
        if (!this.message.author) {
            return;
        }
        this.message.author.openProfile();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickFailure(ev) {
        markEventHandled(ev, 'Message.ClickFailure');
        this.message.openResendAction();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickOriginThread(ev) {
        // avoid following dummy href
        ev.preventDefault();
        this.message.originThread.open();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickStar(ev) {
        ev.stopPropagation();
        this.message.toggleStar();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickMarkAsRead(ev) {
        ev.stopPropagation();
        this.message.markAsRead();
    }

    /**
     * @private
     * @param {MouseEvent} ev
     */
    _onClickReply(ev) {
        // Use this._wasSelected because this.props.isSelected might be changed
        // by a global capture click handler (for example the one from Composer)
        // before the current handler is executed. Indeed because it does a
        // toggle it needs to take into account the value before the click.
        if (this._wasSelected) {
            this.message.messaging.discuss.clearReplyingToMessage();
        } else {
            this.message.replyTo();
        }
    }
}

Object.assign(Message, {
    defaultProps: {
        hasMarkAsReadIcon: false,
        hasReplyIcon: false,
        isSquashed: false,
    },
    props: {
        attachmentsDetailsMode: {
            type: String,
            optional: true,
            validate: prop => ['auto', 'card', 'hover', 'none'].includes(prop),
        },
        hasMarkAsReadIcon: Boolean,
        hasReplyIcon: Boolean,
        isSquashed: Boolean,
        messageLocalId: String,
        threadViewLocalId: {
            type: String,
            optional: true,
        },
    },
    template: 'mail.Message',
});

registerMessagingComponent(Message);
