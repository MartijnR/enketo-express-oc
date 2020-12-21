// Modify the Enketo Core branch module.

import branchModule from 'enketo-core/src/js/relevant';
import { getXPath } from 'enketo-core/src/js/dom-utils';
import events from 'enketo-core/src/js/event';

/**
 * Overwrite core functionality by **always** adding
 * .or-group.invalid-relevant and .or-group-data.invalid-relevant.
 *
 * @param updated
 */
branchModule.update = function( updated ) {
    if ( !this.form ) {
        throw new Error( 'Branch module not correctly instantiated with form property.' );
    }

    const nodes = this.form.getRelatedNodes( 'data-relevant', '', updated )
        // the OC customization:
        .add( this.form.getRelatedNodes( 'data-relevant', '.invalid-relevant' ) ).get();

    this.updateNodes( nodes );
};

branchModule.originalSelfRelevant = branchModule.selfRelevant;

// Overwrite in order to add the && !branchNode.classList.contains('invalid-relevant') clause because an irrelevant branch in OC,
// would not be disabled if it is a question with a value!
branchModule.selfRelevant = function( branchNode ) {
    return this.originalSelfRelevant( branchNode ) && !branchNode.classList.contains( 'invalid-relevant' );
};

branchModule.originalEnable = branchModule.enable;

/**
 * Overwrite core functionality.
 * The reason for this customization is to remove any shown irrelevant errors on the group (and perhaps question as well?)
 * once it becomes relevant again.
 *
 * @param branchNode
 * @param path
 */
branchModule.enable = function( branchNode, path ) {
    const change = this.originalEnable( branchNode, path );
    branchNode.classList.remove( 'invalid-relevant' );

    return change;
};

/*
 * Overwrite to always call this.clear if ever enabled and currently relevant.
 */
branchModule.disable = function( branchNode, path ) {
    let changed = false;

    if ( this.selfRelevant( branchNode ) ) {
        changed = true;

        this.clear( branchNode, path );
        this.deactivate( branchNode );
    } else {
        // This processing (for OC) likely affects loading performance negatively for forms with lots of relevant conditions
        // that are false by default.
        // If a non-relevant question has a value upon load (dynamic default e.g.) OC would like to show a relevantError.
        this.deactivate( branchNode );
    }

    return changed;
};

/**
 * Overwrite clear function
 *
 * @param branchNode
 * @param path
 */
branchModule.clear = function( branchNode ) {
    // Only user can clear values from user-input fields in OC.
    // TODO: when readonly becomes dynamic, we'll have to fix this.
    // Only for readonly items in OC fork:
    [ ...branchNode.querySelectorAll( 'input[readonly]:not(.ignore), select[readonly]:not(.ignore), textarea[readonly]:not(.ignore)' ) ]
        .map( control => control.closest( '.question' ) )
        .forEach( question => this.form.input.clear( question, events.Change(), events.InputUpdate() ) );

    // Also changed from Enketo Core, we never update calculated items if relevancy changes:
};


branchModule.activate = function( branchNode ) {
    let required;

    this.setDisabledProperty( branchNode, false );
    if ( branchNode.matches( '.question' ) ) {
        const control = branchNode.querySelector( 'input:not(.ignore), select:not(.ignore), textarea:not(.ignore)' );
        this.form.setValid( control, 'relevant' );
        // Re-show any constraint error message when the relevant error has been removed.
        // Since validateInput looks at both required and constraint, and we don't want required
        // validation, we use a very dirty trick to bypass it.
        required = control.dataset.required;

        if ( required ) {
            delete control.dataset.required;
        }
        this.form.validateInput( control );
        if ( required ) {
            control.dataset.required = required;
        }

    } else if ( branchNode.matches( '.or-group, .or-group-data' ) ) {
        this.form.setValid( branchNode, 'relevant' );
    }
};

branchModule.originalDeactivate = branchModule.deactivate;

// Overwrite deactivate function
branchModule.deactivate = function( branchNode ) {
    let value;
    const control = branchNode.querySelector( 'input:not(.ignore), select:not(.ignore), textarea:not(.ignore)' );

    if ( branchNode.matches( '.question' ) ) {
        const name = this.form.input.getName( control );
        const index = this.form.input.getIndex( control );
        value = this.form.model.node( name, index ).getVal();

        if ( value !== '' ) {
            //$branchNode.removeClass( 'disabled' );
            this.form.setInvalid( control, 'relevant' );
            // After setting invalid-relevant remove any previous errors.
            this.form.setValid( control, 'constraint' );
            this.form.setValid( control, 'required' );
        } else {
            this.form.setValid( control, 'relevant' );
            this.originalDeactivate( branchNode );
            branchNode.dispatchEvent( events.Hiding() );
        }

    } else if ( branchNode.matches( '.or-group, .or-group-data' ) ) {
        const name = this.form.input.getName( branchNode );
        const index = this.form.input.getIndex( branchNode );
        /*
         * We need to check if any of the fields with a form control or calculations
         * (ie. excl discrepancy note questions) has a value.
         * The best way is to do this in the model.
         * Note that we need to check ALL repeats if the repeat parent (with the same /path/to/repeat) has a relevant!
         *
         * First get all the leaf nodes (nodes without children) and then check if there is a calculation
         * or dn question, or readonly question for this node.
         *
         * Then get the concatenated textContent of the filtered leaf nodes and trim to avoid
         * recognizing whitespace-only as a value. (whitespace in between is fine as it won't give a false positive)
         *
         * If the result has length > 0, one form control in the group has a value.
         */
        const dataEls = this.form.model.node( name, index ).getElements();

        if ( !dataEls.length ) {
            value = false;
        } else {
            value = dataEls.some( dataEl => {
                return [ ...dataEl.querySelectorAll( '*' ) ]
                    .filter( el => {
                        if ( el.children.length === 0 ) {
                            const path = getXPath( el, 'instance' );
                            const selector = `.calculation > [name="${path}"], .or-appearance-dn > [name="${path}"], [readonly][name="${path}"]`;
                            // If a repeat has zero instances, the search for .or-appearance-dn in form.html will result in null, which means the dn-detection would fail.
                            const searchElements = [ this.form.view.html ].concat( Object.entries( this.form.repeats.templates ).map( entries => entries[ 1 ] ) );
                            const ignore = searchElements.some( e => !!e.querySelector( selector ) );

                            return !ignore;
                        }

                        return false;
                    } )
                    .map( el => el.textContent ? el.textContent.trim() : '' )
                    .join( '' );
            } );
        }

        if ( value ) {
            this.form.setInvalid( branchNode, 'relevant' );
        } else {
            this.form.setValid( branchNode, 'relevant' );
            this.originalDeactivate( branchNode );
            // trigger on all questions inside this group that possibly have a discrepancy note attached to them.
            branchNode.querySelectorAll( '.question' ).forEach( question => question.dispatchEvent( events.Hiding() ) );
        }
    }
};
