// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require){
  var Origin = require('core/origin');
  var OriginView = require('core/views/originView');
  var CourseModel = require('core/models/courseModel');
  var ProjectView = require('./projectView');
  var SharedProjectView = require('./sharedProjectView');

  var MY_PROJECT_URL = 'api/my/course';
  var SHARED_PROJECT_URL = 'api/shared/course';

  var ProjectsView = OriginView.extend({
    className: 'projects',
    supportedLayouts: [
      "grid",
      "list"
    ],

    initialize: function() {
      var ProjectCollection = Backbone.Collection.extend({ model: CourseModel, url: MY_PROJECT_URL });
      this.collection = new ProjectCollection();

      OriginView.prototype.initialize.apply(this, arguments);
    },

    postRender: function() {
      this.settings.preferencesKey = 'projects';
      this.initUserPreferences();
      this.initEventListeners();
      this.initPaging();
    },

    initEventListeners: function() {
      this._doLazyScroll = _.bind(_.throttle(this.doLazyScroll, 250), this);
      this._onResize = _.bind(_.debounce(this.onResize, 250), this);

      this.listenTo(Origin, {
        'window:resize': this._onResize,
        'projects:dashboardSidebarView:filterBySearch': function(text) { this.doFilter(text) },
        'projects:dashboardSidebarView:filterByTags': function(tags) { this.doFilter(null, tags) },
        'projects:sort:asc': function() { this.doSort('asc'); },
        'projects:sort:desc': function() { this.doSort('desc'); },
        'projects:sort:updated': function() { this.doSort('updated'); },
        'sidebar:action:createproject': this.createProject,
        'sidebar:link': this.switchCollection
      });

      this.supportedLayouts.forEach(function(layout) {
        this.listenTo(Origin, 'projects:layout:' + layout, function() { this.doLayout(layout); });
      }, this);

      this.listenTo(this.collection, 'add', this.appendProjectItem);

      $('.contentPane').on('scroll', this._doLazyScroll);
    },

    initUserPreferences: function() {
      var prefs = this.getUserPreferences();

      this.doLayout(prefs.layout);
      this.doSort(prefs.sort, false);
      this.doFilter(prefs.search, prefs.tags, false);
      // set relevant filters as selected
      $("a[data-callback='projects:layout:" + prefs.layout + "']").addClass('selected');
      $("a[data-callback='projects:sort:" + prefs.sort + "']").addClass('selected');
      // need to refresh this to get latest filters
      prefs = this.getUserPreferences();
      Origin.trigger('options:update:ui', prefs);
      Origin.trigger('sidebar:update:ui', prefs);
    },

    // Set some default preferences
    getUserPreferences: function() {
      var prefs = OriginView.prototype.getUserPreferences.apply(this, arguments);

      if(!prefs.layout) prefs.layout = 'grid';
      if(!prefs.sort) prefs.sort = 'asc';

      return prefs;
    },

    initPaging: function() {
      if(this.resizeTimer) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = -1;
      }
      // we need to load one course first to check page size
      this.pageSize = 1;
      this.resetCollection(_.bind(function(collection) {
        var containerHeight = $(window).height()-this.$el.offset().top;
        var containerWidth = this.$('.projects-inner').width();
        var itemHeight = $('.project-list-item').outerHeight(true);
        var itemWidth = $('.project-list-item').outerWidth(true);
        var columns = Math.floor(containerWidth/itemWidth);
        var rows = Math.floor(containerHeight/itemHeight);
        // columns stack nicely, but need to add extra row if it's not a clean split
        if((containerHeight % itemHeight) > 0) rows++;
        this.pageSize = columns*rows;
        // need another reset to get the actual pageSize number of items
        this.resetCollection(this.setViewToReady);
      }, this));
    },

    getProjectsContainer: function() {
      return this.$('.projects-list');
    },

    emptyProjectsContainer: function() {
      Origin.trigger('projects:dashboardView:removeSubViews');
      this.getProjectsContainer().empty();
    },

    appendProjectItem: function(model) {
      var viewClass = model.isEditable() ? ProjectView : SharedProjectView;
      this.getProjectsContainer().append(new viewClass({ model: model }).$el);
    },

    convertFilterTextToPattern: function(filterText) {
      var pattern = '.*' + filterText.toLowerCase() + '.*';
      return { title: pattern };
    },

    resetCollection: function(cb) {
      this.emptyProjectsContainer();
      this.fetchCount = 0;
      this.shouldStopFetches = false;
      this.collection.reset();
      this.fetchCollection(cb);
    },

    fetchCollection: function(cb) {
      if(this.shouldStopFetches) {
        return;
      }
      this.isCollectionFetching = true;

      this.collection.fetch({
        data: {
          search: _.extend(this.search, { tags: { $all: this.tags } }),
          operators : {
            skip: this.fetchCount,
            limit: this.pageSize,
            sort: this.sort
          }
        },
        success: _.bind(function(collection, response) {
          this.isCollectionFetching = false;
          this.fetchCount += response.length;
          // stop further fetching if this is the last page
          if(response.length < this.pageSize) this.shouldStopFetches = true;

          this.$('.no-projects').toggleClass('display-none', this.fetchCount > 0);
          if(typeof cb === 'function') cb(collection);
        }, this)
      });
    },

    switchCollection: function(view) {
      var newURL;
      switch(view) {
        case 'myprojects':
          newURL = MY_PROJECT_URL;
          break;
        case 'sharedprojects':
          newURL = SHARED_PROJECT_URL;
          break;
        default: return;
      }
      if(newURL !== this.collection.url) {
        this.collection.url = newURL;
        this.resetCollection();
      }
    },

    doLazyScroll: function(e) {
      if(this.isCollectionFetching) {
        return;
      }
      var $el = $(e.currentTarget);
      var pxRemaining = this.getProjectsContainer().height() - ($el.scrollTop() + $el.height());
      // we're at the bottom, fetch more
      if (pxRemaining <= 0) this.fetchCollection();
    },

    doLayout: function(layout) {
      if(this.supportedLayouts.indexOf(layout) === -1) {
        return;
      }
      this.getProjectsContainer().attr('data-layout', layout);
      this.setUserPreference('layout', layout);
    },

    doSort: function(sort, fetch) {
      switch(sort) {
        case "desc":
          this.sort = { title: -1 };
          break;
        case "updated":
          this.sort = { updatedAt: -1 };
          break;
        case "asc":
        default:
          sort = "asc";
          this.sort = { title: 1 };
      }
      this.setUserPreference('sort', sort);
      if(fetch !== false) this.resetCollection();
    },

    doFilter: function(text, tags, fetch) {
      text = text || '';
      this.filterText = text;
      this.search = this.convertFilterTextToPattern(text);
      this.setUserPreference('search', text, true);

      tags = tags || [];
      this.tags = _.pluck(tags, 'id');
      this.setUserPreference('tags', tags, true);

      if(fetch !== false) this.resetCollection();
    },

    onResize: function() {
      this.initPaging();
    },

    remove: function() {
      $('.contentPane').off('scroll', this._doLazyScroll);
      OriginView.prototype.remove.apply(this, arguments);
    },

    createProject: function() {
      Origin.router.navigateTo('editor/config')
    }
  }, {
    template: 'projects'
  });

  return ProjectsView;
});
