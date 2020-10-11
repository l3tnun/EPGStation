<template>
    <div class="loading d-flex justify-center align-center">
        <v-progress-circular :size="60" :width="4" color="primary" indeterminate></v-progress-circular>
    </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

@Component({})
export default class Loading extends Vue {}
</script>

<style lang="sass" scoped>
.loading
    position: absolute
    width: 100%
    height: 100%
    background: rgb(0, 0, 0, 0.6)
    z-index: 5
</style>
