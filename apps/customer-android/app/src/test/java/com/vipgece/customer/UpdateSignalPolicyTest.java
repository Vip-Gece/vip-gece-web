package com.vipgece.customer;

import org.junit.Test;
import static org.junit.Assert.*;

public final class UpdateSignalPolicyTest {
    @Test public void onlyNewVersionsTriggerChecks(){
        assertTrue(UpdateSignalPolicy.shouldCheck("customer_update","10002",10001,1000000,0,true));
        assertFalse(UpdateSignalPolicy.shouldCheck("customer_update","10001",10001,1000000,0,true));
        assertFalse(UpdateSignalPolicy.shouldCheck("customer_update","2",10001,1000000,0,true));
    }
    @Test public void ignoresArbitraryCommandsAndUrls(){
        for(String type:new String[]{"install","open_url","execute",null})assertFalse(UpdateSignalPolicy.shouldCheck(type,"10002",10001,1000000,0,true));
        for(String value:new String[]{"https://example.org/app.apk","2147483648","-1","1e9","999999999999999999999",null})assertFalse(UpdateSignalPolicy.shouldCheck("customer_update",value,10001,1000000,0,true));
    }
    @Test public void respectsOptOutRateLimitAndClockRollback(){
        assertFalse(UpdateSignalPolicy.shouldCheck("customer_update","10002",10001,1000000,0,false));
        assertFalse(UpdateSignalPolicy.shouldCheck("customer_update","10002",10001,1000000,999999,true));
        assertFalse(UpdateSignalPolicy.shouldCheck("customer_update","10002",10001,1,999999,true));
        assertTrue(UpdateSignalPolicy.shouldCheck("customer_update","10002",10001,2000000,1,true));
    }
}
