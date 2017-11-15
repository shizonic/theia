// Copyright (c) Jupyter Development Team and others
// Distributed under the terms of the Modified BSD License.
/*
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject, optional } from 'inversify';
import { ArrayExt, each, find, toArray } from "@phosphor/algorithm";
import { ISignal, Signal } from "@phosphor/signaling";
import {
    BoxLayout,
    BoxPanel,
    DockPanel,
    DockLayout,
    FocusTracker,
    Panel,
    SplitPanel,
    StackedPanel,
    TabBar,
    Title,
    Widget
} from "@phosphor/widgets";
import { VirtualElement, h } from '@phosphor/virtualdom';
import { MenuPath } from "../common";
import { Saveable } from "./saveable";
import { ContextMenuRenderer } from "./context-menu-renderer";
import { StatusBarImpl, StatusBarLayoutData } from "./status-bar/status-bar";

export const ApplicationShellOptions = Symbol("ApplicationShellOptions");

/**
 * The class name added to AppShell instances.
 */
const APPLICATION_SHELL_CLASS = 'theia-ApplicationShell';

/**
 * The class name added to side bar instances.
 */
const SIDEBAR_CLASS = 'theia-SideBar';

/**
 * The class name added to the current widget's title.
 */
const CURRENT_CLASS = 'theia-mod-current';

/**
 * The class name added to the active widget's title.
 */
const ACTIVE_CLASS = 'theia-mod-active';

export interface LayoutData {
    mainArea?: DockLayoutData;
    leftBar?: SideBarData;
    rightBar?: SideBarData;
    statusBar?: StatusBarLayoutData;
}

export interface SideBarData {
    activeWidgets?: Widget[];
    widgets?: Widget[];
}

export interface DockLayoutData extends DockPanel.ILayoutConfig {
    activeWidgets?: Widget[]
}

export const MAINAREA_TABBAR_CONTEXT_MENU: MenuPath = ['mainarea-tabbar-context-menu'];

export const DockPanelTabBarRendererFactory = Symbol('DockPanelTabBarRendererFactory');

@injectable()
export class DockPanelTabBarRenderer implements TabBar.IRenderer<any> {
    readonly closeIconSelector = TabBar.defaultRenderer.closeIconSelector;

    protected _tabBar: TabBar<Widget> | undefined = undefined;
    constructor( @inject(ContextMenuRenderer) protected readonly contextMenuRenderer: ContextMenuRenderer) { }

    renderTab(data: TabBar.IRenderData<any>): VirtualElement {
        const title = data.title;
        const key = TabBar.defaultRenderer.createTabKey(data);
        const style = TabBar.defaultRenderer.createTabStyle(data);
        const className = TabBar.defaultRenderer.createTabClass(data);
        const dataset = TabBar.defaultRenderer.createTabDataset(data);
        return (
            h.li({
                key, className, title: title.caption, style, dataset,
                oncontextmenu: event => this.handleContextMenuEvent(event, title)
            },
                TabBar.defaultRenderer.renderIcon(data),
                TabBar.defaultRenderer.renderLabel(data),
                TabBar.defaultRenderer.renderCloseIcon(data)
            )
        );
    }

    set tabBar(tabBar: TabBar<Widget>) {
        this._tabBar = tabBar;
    }

    handleContextMenuEvent(event: MouseEvent, title: Title<Widget>) {
        event.stopPropagation();
        event.preventDefault();

        if (this._tabBar !== undefined) {
            this._tabBar.currentTitle = title;
            if (title.owner !== null) {
                title.owner.activate();
            }
        }

        this.contextMenuRenderer.render(MAINAREA_TABBAR_CONTEXT_MENU, event);
    }
}

@injectable()
export class DockPanelRenderer implements DockLayout.IRenderer {

    constructor( @inject(DockPanelTabBarRendererFactory) protected readonly tabBarRendererFactory: () => DockPanelTabBarRenderer) {
    }

    createTabBar(): TabBar<Widget> {
        const renderer = this.tabBarRendererFactory();
        const bar = new TabBar<Widget>({ renderer });
        bar.addClass('p-DockPanel-tabBar');
        renderer.tabBar = bar;
        return bar;
    }

    createHandle(): HTMLDivElement {
        return DockPanel.defaultRenderer.createHandle();
    }
}

/**
 * The application shell.
 */
@injectable()
export class ApplicationShell extends Widget {
    /**
     * Construct a new application shell.
     */
    constructor(
        @inject(DockPanelRenderer) dockPanelRenderer: DockPanelRenderer,
        @inject(StatusBarImpl) protected readonly _statusBar: StatusBarImpl,
        @inject(ApplicationShellOptions) @optional() options?: Widget.IOptions | undefined
    ) {
        super(options);
        this.addClass(APPLICATION_SHELL_CLASS);
        this.id = 'main';

        const topPanel = this._topPanel = new Panel();
        const hboxPanel = this._hboxPanel = new BoxPanel();
        const dockPanel = this._dockPanel = new DockPanel({ renderer: dockPanelRenderer });
        const hsplitPanel = this._hsplitPanel = new SplitPanel();
        const leftHandler = this._leftHandler = new Private.SideBarHandler('left');
        const rightHandler = this._rightHandler = new Private.SideBarHandler('right');
        const rootLayout = new BoxLayout();

        topPanel.id = 'theia-top-panel';
        hboxPanel.id = 'theia-main-content-panel';
        dockPanel.id = 'theia-main-dock-panel';
        hsplitPanel.id = 'theia-main-split-panel';

        leftHandler.sideBar.addClass(SIDEBAR_CLASS);
        leftHandler.sideBar.addClass('theia-mod-left');
        leftHandler.stackedPanel.id = 'theia-left-stack';

        rightHandler.sideBar.addClass(SIDEBAR_CLASS);
        rightHandler.sideBar.addClass('theia-mod-right');
        rightHandler.stackedPanel.id = 'theia-right-stack';

        hboxPanel.spacing = 0;
        dockPanel.spacing = 0;
        hsplitPanel.spacing = 0;

        hboxPanel.direction = 'left-to-right';
        hsplitPanel.orientation = 'horizontal';

        SplitPanel.setStretch(leftHandler.stackedPanel, 0);
        SplitPanel.setStretch(dockPanel, 1);
        SplitPanel.setStretch(rightHandler.stackedPanel, 0);

        BoxPanel.setStretch(leftHandler.sideBar, 0);
        BoxPanel.setStretch(hsplitPanel, 1);
        BoxPanel.setStretch(rightHandler.sideBar, 0);

        hsplitPanel.addWidget(leftHandler.stackedPanel);
        hsplitPanel.addWidget(dockPanel);
        hsplitPanel.addWidget(rightHandler.stackedPanel);

        hboxPanel.addWidget(leftHandler.sideBar);
        hboxPanel.addWidget(hsplitPanel);
        hboxPanel.addWidget(rightHandler.sideBar);

        rootLayout.direction = 'top-to-bottom';
        rootLayout.spacing = 0; // TODO make this configurable?

        BoxLayout.setStretch(topPanel, 0);
        BoxLayout.setStretch(hboxPanel, 1);
        BoxLayout.setStretch(_statusBar, 0);

        rootLayout.addWidget(topPanel);
        rootLayout.addWidget(hboxPanel);
        rootLayout.addWidget(_statusBar);

        this.layout = rootLayout;

        this._tracker.currentChanged.connect(this._onCurrentChanged, this);
        this._tracker.activeChanged.connect(this._onActiveChanged, this);

    }

    getLayoutData(): LayoutData {
        return {
            mainArea: {
                activeWidgets: this._tracker.activeWidget ? [this._tracker.activeWidget] : [],
                ...this._dockPanel.saveLayout()
            },
            leftBar: this._leftHandler.getLayoutData(),
            rightBar: this._rightHandler.getLayoutData(),
            statusBar: this._statusBar.getLayoutData()
        };
    }

    setLayoutData(layoutData?: LayoutData): void {
        if (layoutData) {
            if (layoutData.mainArea) {
                this._dockPanel.restoreLayout(layoutData.mainArea);
                this.registerWithFocusTracker(layoutData.mainArea.main);
                if (layoutData.mainArea.activeWidgets) {
                    for (const activeWidget of layoutData.mainArea.activeWidgets) {
                        this.activateMain(activeWidget.id);
                    }
                }
            }
            this._leftHandler.setLayoutData(layoutData.leftBar);
            this._rightHandler.setLayoutData(layoutData.rightBar);
            this._statusBar.setLayoutData(layoutData.statusBar);
        }
    }

    // tslint:disable-next-line:no-any
    protected registerWithFocusTracker(data: any): void {
        if (!data) {
            return;
        }
        if (data.hasOwnProperty("widgets")) {
            for (const widget of data["widgets"] as Widget[]) {
                this.track(widget);
            }
        } else if (data.hasOwnProperty("children")) {
            for (const child of data["children"] as object[]) {
                this.registerWithFocusTracker(child);
            }
        }
    }

    /**
     * A signal emitted when main area's current focus changes.
     */
    get currentChanged(): ISignal<this, ApplicationShell.IChangedArgs> {
        return this._currentChanged;
    }

    /**
     * A signal emitted when main area's active focus changes.
     */
    get activeChanged(): ISignal<this, ApplicationShell.IChangedArgs> {
        return this._activeChanged;
    }

    /**
     * The current widget in the shell's main area.
     */
    get currentWidget(): Widget | null {
        return this._tracker.currentWidget;
    }

    /**
     * The active widget in the shell's main area.
     */
    get activeWidget(): Widget | null {
        return this._tracker.activeWidget;
    }

    /**
     * True if left area is empty.
     */
    get leftAreaIsEmpty(): boolean {
        return this._leftHandler.stackedPanel.widgets.length === 0;
    }

    /**
     * True if main area is empty.
     */
    get mainAreaIsEmpty(): boolean {
        return this._dockPanel.isEmpty;
    }

    /**
     * True if right area is empty.
     */
    get rightAreaIsEmpty(): boolean {
        return this._rightHandler.stackedPanel.widgets.length === 0;
    }

    /**
     * True if top area is empty.
     */
    get topAreaIsEmpty(): boolean {
        return this._topPanel.widgets.length === 0;
    }

    /**
     * Activate a widget in the left area.
     */
    activateLeft(id: string): void {
        this._leftHandler.activate(id);
    }

    /**
     * Activate a widget in the main area.
     */
    activateMain(id: string): void {
        const dock = this._dockPanel;
        const widget = find(dock.widgets(), value => value.id === id);
        if (widget) {
            dock.activateWidget(widget);
        }
    }

    /*
     * Activate the next Tab in the active TabBar.
     */
    activateNextTab(): void {
        const current = this._currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                if (ci < current.titles.length - 1) {
                    current.currentIndex += 1;
                    if (current.currentTitle) {
                        current.currentTitle.owner.activate();
                    }
                } else if (ci === current.titles.length - 1) {
                    const nextBar = this._nextTabBar();
                    if (nextBar) {
                        nextBar.currentIndex = 0;
                        if (nextBar.currentTitle) {
                            nextBar.currentTitle.owner.activate();
                        }
                    }
                }
            }
        }
    }

    /*
     * Activate the previous Tab in the active TabBar.
     */
    activatePreviousTab(): void {
        const current = this._currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                if (ci > 0) {
                    current.currentIndex -= 1;
                    if (current.currentTitle) {
                        current.currentTitle.owner.activate();
                    }
                } else if (ci === 0) {
                    const prevBar = this._previousTabBar();
                    if (prevBar) {
                        const len = prevBar.titles.length;
                        prevBar.currentIndex = len - 1;
                        if (prevBar.currentTitle) {
                            prevBar.currentTitle.owner.activate();
                        }
                    }
                }
            }
        }
    }

    /**
     * Activate a widget in the right area.
     */
    activateRight(id: string): void {
        this._rightHandler.activate(id);
    }

    /**
     * Add a widget to the left content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToLeftArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        const rank = options.rank !== undefined ? options.rank : 100;
        this._leftHandler.addWidget(widget, rank);
    }

    /**
     * Add a widget to the main content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     * All widgets added to the main area should be disposed after removal (or
     * simply disposed in order to remove).
     */
    addToMainArea(widget: Widget): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        this._dockPanel.addWidget(widget, { mode: 'tab-after' });
        this.track(widget);
    }

    /**
     * Add a widget to the right content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToRightArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        const rank = options.rank !== undefined ? options.rank : 100;
        this._rightHandler.addWidget(widget, rank);
    }

    /**
     * Add a widget to the top content area.
     *
     * #### Notes
     * Widgets must have a unique `id` property, which will be used as the DOM id.
     */
    addToTopArea(widget: Widget, options: ApplicationShell.ISideAreaOptions = {}): void {
        if (!widget.id) {
            console.error('widgets added to app shell must have unique id property');
            return;
        }
        // Temporary: widgets are added to the panel in order of insertion.
        this._topPanel.addWidget(widget);
    }

    /**
     * Collapse the left area.
     */
    collapseLeft(): void {
        this._leftHandler.collapse();
    }

    /**
     * Collapse the right area.
     */
    collapseRight(): void {
        this._rightHandler.collapse();
    }

    /**
     * Close the current tab.
     */
    closeTab(): void {
        const current = this._currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                const title = current.currentTitle;
                if (title !== null) {
                    title.owner.close();
                }
            }
        }
    }

    /**
     * Close the tabs right of the current one.
     */
    closeRightTabs(): void {
        const current = this._currentTabBar();
        if (current) {
            const length = current.titles.length;
            if (length > 0) {
                const ci = current.currentIndex;
                const last = length - 1;
                const next = ci + 1;
                if (ci !== -1 && last > ci) {
                    for (let i = next; i <= last; i++) {
                        current.titles[next].owner.close();
                    }
                }
            }
        }
    }

    /**
     * Close all tabs expect the current one.
     */
    closeOtherTabs(): void {
        const current = this._currentTabBar();
        if (current) {
            const ci = current.currentIndex;
            if (ci !== -1) {
                const titles = current.titles.slice(0);
                for (let i = 0; i < titles.length; i++) {
                    if (i !== ci) {
                        titles[i].owner.close();
                    }
                }
            }

        }
    }

    /**
     * Close all tabs.
     */
    closeAllTabs(): void {
        const current = this._currentTabBar();
        if (current) {
            const length = current.titles.length;
            for (let i = 0; i < length; i++) {
                current.titles[0].owner.close();
            }
        }
    }

    /**
     * Test whether the current widget is dirty.
     */
    canSave(): boolean {
        return Saveable.isDirty(this.currentWidget);
    }

    /**
     * Save the current widget if it is dirty.
     */
    async save(): Promise<void> {
        await Saveable.save(this.currentWidget);
    }

    /**
     * Test whether there is a dirty widget.
     */
    canSaveAll(): boolean {
        return this._tracker.widgets.some(Saveable.isDirty);
    }

    /**
     * Save all dirty widgets.
     */
    async saveAll(): Promise<void> {
        await Promise.all(this._tracker.widgets.map(Saveable.save));
    }

    /**
     * Close all widgets in the main area.
     */
    closeAll(): void {
        each(toArray(this._dockPanel.widgets()), widget => {
            widget.close();
        });
    }

    /**
     * Checks to see if a tab is currently selected
     */
    hasSelectedTab(): boolean {
        const current = this._currentTabBar();
        if (current) {
            return current.currentIndex !== -1;
        } else {
            return false;
        }
    }

    /*
     * Return the TabBar that has the currently active Widget or undefined.
     */
    private _currentTabBar(): TabBar<Widget> | undefined {
        const current = this._tracker.currentWidget;
        if (current) {
            const title = current.title;
            const tabBar = find(this._dockPanel.tabBars(), bar => {
                return ArrayExt.firstIndexOf(bar.titles, title) > -1;
            });
            return tabBar;
        }
        return undefined;
    }

    /*
     * Return the TabBar previous to the current TabBar (see above) or undefined.
     */
    private _previousTabBar(): TabBar<Widget> | null {
        const current = this._currentTabBar();
        if (current) {
            const bars = toArray(this._dockPanel.tabBars());
            const len = bars.length;
            const ci = ArrayExt.firstIndexOf(bars, current);
            let prevBar: TabBar<Widget> | null = null;
            if (ci > 0) {
                prevBar = bars[ci - 1];
            } else if (ci === 0) {
                prevBar = bars[len - 1];
            }
            return prevBar;
        }
        return null;
    }

    /*
     * Return the TabBar next to the current TabBar (see above) or undefined.
     */
    private _nextTabBar(): TabBar<Widget> | null {
        const current = this._currentTabBar();
        if (current) {
            const bars = toArray(this._dockPanel.tabBars());
            const len = bars.length;
            const ci = ArrayExt.firstIndexOf(bars, current);
            let nextBar: TabBar<Widget> | null = null;
            if (ci < (len - 1)) {
                nextBar = bars[ci + 1];
            } else if (ci === len - 1) {
                nextBar = bars[0];
            }
            return nextBar;
        }
        return null;
    }

    /**
     * Handle a change to the dock area current widget.
     */
    private _onCurrentChanged(sender: any, args: FocusTracker.IChangedArgs<Widget>): void {
        if (args.newValue) {
            args.newValue.title.className += ` ${CURRENT_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = (
                args.oldValue.title.className.replace(CURRENT_CLASS, '')
            );
        }
        this._currentChanged.emit(args);
    }

    /**
     * Handle a change to the dock area active widget.
     */
    private _onActiveChanged(sender: any, args: FocusTracker.IChangedArgs<Widget>): void {
        if (args.newValue) {
            args.newValue.title.className += ` ${ACTIVE_CLASS}`;
        }
        if (args.oldValue) {
            args.oldValue.title.className = (
                args.oldValue.title.className.replace(ACTIVE_CLASS, '')
            );
        }
        this._activeChanged.emit(args);
    }

    protected track(widget: Widget): void {
        this._tracker.add(widget);
        Saveable.apply(widget);
    }

    private _dockPanel: DockPanel;
    private _hboxPanel: BoxPanel;
    private _hsplitPanel: SplitPanel;
    private _leftHandler: Private.SideBarHandler;
    private _rightHandler: Private.SideBarHandler;
    private _topPanel: Panel;
    private _tracker = new FocusTracker<Widget>();
    private _currentChanged = new Signal<this, ApplicationShell.IChangedArgs>(this);
    private _activeChanged = new Signal<this, ApplicationShell.IChangedArgs>(this);
}

/**
 * The namespace for `ApplicationShell` class statics.
 */
export
namespace ApplicationShell {
    /**
     * The areas of the application shell where widgets can reside.
     */
    export
        type Area = 'main' | 'top' | 'left' | 'right';

    /**
     * The options for adding a widget to a side area of the shell.
     */
    export
        interface ISideAreaOptions {
        /**
         * The rank order of the widget among its siblings.
         */
        rank?: number;
    }

    /**
     * An arguments object for the changed signals.
     */
    export
        type IChangedArgs = FocusTracker.IChangedArgs<Widget>;
}

namespace Private {
    /**
     * An object which holds a widget and its sort rank.
     */
    export
        interface IRankItem {
        /**
         * The widget for the item.
         */
        widget: Widget;

        /**
         * The sort rank of the widget.
         */
        rank: number;
    }

    /**
     * A less-than comparison function for side bar rank items.
     */
    export function itemCmp(first: IRankItem, second: IRankItem): number {
        return first.rank - second.rank;
    }

    /**
     * A class which manages a side bar and related stacked panel.
     */
    export class SideBarHandler {
        /**
         * Construct a new side bar handler.
         */
        constructor(side: string) {
            this._side = side;
            this._sideBar = new TabBar<Widget>({
                insertBehavior: 'none',
                removeBehavior: 'none',
                allowDeselect: true
            });
            this._stackedPanel = new StackedPanel();
            this._sideBar.hide();
            this._stackedPanel.hide();
            this._sideBar.currentChanged.connect(this._onCurrentChanged, this);
            this._sideBar.tabActivateRequested.connect(this._onTabActivateRequested, this);
            this._stackedPanel.widgetRemoved.connect(this._onWidgetRemoved, this);
        }

        getLayoutData(): SideBarData {
            const currentActive = this._findWidgetByTitle(this._sideBar.currentTitle) || undefined;
            return {
                activeWidgets: currentActive ? [currentActive] : [],
                widgets: this.stackedPanel.widgets as Widget[]
            };
        }

        setLayoutData(layoutData: SideBarData | undefined) {
            if (layoutData) {
                this.collapse();
                if (layoutData.widgets) {
                    let index = 0;
                    for (const widget of layoutData.widgets) {
                        if (widget) {
                            this.addWidget(widget, index++);
                        }
                    }
                }
                if (layoutData.activeWidgets) {
                    for (const widget of layoutData.activeWidgets) {
                        this.activate(widget.id);
                    }
                }
            }
        }

        /**
         * Get the tab bar managed by the handler.
         */
        get sideBar(): TabBar<Widget> {
            return this._sideBar;
        }

        /**
         * Get the stacked panel managed by the handler
         */
        get stackedPanel(): StackedPanel {
            return this._stackedPanel;
        }

        /**
         * Activate a widget residing in the side bar by ID.
         *
         * @param id - The widget's unique ID.
         */
        activate(id: string): void {
            const widget = this._findWidgetByID(id);
            if (widget) {
                this._sideBar.currentTitle = widget.title;
                widget.activate();
            }
        }

        /**
         * Collapse the sidebar so no items are expanded.
         */
        collapse(): void {
            this._sideBar.currentTitle = null;
        }

        /**
         * Add a widget and its title to the stacked panel and side bar.
         *
         * If the widget is already added, it will be moved.
         */
        addWidget(widget: Widget, rank: number): void {
            widget.parent = null;
            widget.hide();
            const item = { widget, rank };
            const index = this._findInsertIndex(item);
            ArrayExt.insert(this._items, index, item);
            this._stackedPanel.insertWidget(index, widget);
            this._sideBar.insertTab(index, widget.title);
            this._refreshVisibility();
        }

        /**
         * Find the insertion index for a rank item.
         */
        private _findInsertIndex(item: Private.IRankItem): number {
            return ArrayExt.upperBound(this._items, item, Private.itemCmp);
        }

        /**
         * Find the index of the item with the given widget, or `-1`.
         */
        private _findWidgetIndex(widget: Widget): number {
            return ArrayExt.findFirstIndex(this._items, item => item.widget === widget);
        }

        /**
         * Find the widget which owns the given title, or `null`.
         */
        private _findWidgetByTitle(title: Title<Widget> | null): Widget | null {
            const item = find(this._items, value => value.widget.title === title);
            return item ? item.widget : null;
        }

        /**
         * Find the widget with the given id, or `null`.
         */
        private _findWidgetByID(id: string): Widget | null {
            const item = find(this._items, value => value.widget.id === id);
            return item ? item.widget : null;
        }

        /**
         * Refresh the visibility of the side bar and stacked panel.
         */
        private _refreshVisibility(): void {
            this._sideBar.setHidden(this._sideBar.titles.length === 0);
            this._stackedPanel.setHidden(this._sideBar.currentTitle === null);
        }

        /**
         * Handle the `currentChanged` signal from the sidebar.
         */
        private _onCurrentChanged(sender: TabBar<Widget>, args: TabBar.ICurrentChangedArgs<Widget>): void {
            const oldWidget = this._findWidgetByTitle(args.previousTitle);
            const newWidget = this._findWidgetByTitle(args.currentTitle);
            if (oldWidget) {
                oldWidget.hide();
            }
            if (newWidget) {
                newWidget.show();
            }
            if (newWidget) {
                document.body.setAttribute(`data-${this._side}Area`, newWidget.id);
            } else {
                document.body.removeAttribute(`data-${this._side}Area`);
            }
            this._refreshVisibility();
        }

        /**
         * Handle a `tabActivateRequest` signal from the sidebar.
         */
        private _onTabActivateRequested(sender: TabBar<Widget>, args: TabBar.ITabActivateRequestedArgs<Widget>): void {
            args.title.owner.activate();
        }

        /*
         * Handle the `widgetRemoved` signal from the stacked panel.
         */
        private _onWidgetRemoved(sender: StackedPanel, widget: Widget): void {
            ArrayExt.removeAt(this._items, this._findWidgetIndex(widget));
            this._sideBar.removeTab(widget.title);
            this._refreshVisibility();
        }

        private _items = new Array<Private.IRankItem>();
        private _side: string;
        private _sideBar: TabBar<Widget>;
        private _stackedPanel: StackedPanel;
    }
}
